import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {accountPaths} from '../../wechat/accounts.mjs'
import {ServiceManager} from '../../setup/platform-service.mjs'
const commands={'诊断':'diagnose','运行诊断':'diagnose','服务状态':'service','查看最近错误':'errors','导出诊断报告':'export'}
export const diagnosticCommand=text=>typeof text==='string'?commands[text.trim()]??null:null
const knownCodes=new Set(['EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOENT','EACCES','ENOSPC','EIO','ABORT_ERR'])
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12)
export async function readDiagnostics(dir){
 const counts={},failures=[],active=new Map();let records=0,invalid=0,last=null,dropped=0,files=0
 for(const name of ['events.jsonl.5','events.jsonl.4','events.jsonl.3','events.jsonl.2','events.jsonl.1','events.jsonl']){
  let data;try{data=await readFile(join(dir,name),'utf8');files++}catch(e){if(e.code==='ENOENT')continue;throw e}
  for(const line of data.split('\n').filter(Boolean)){
   let r;try{r=JSON.parse(line)}catch{invalid++;continue}
   if(!r||typeof r!=='object'||typeof r.event!=='string'||!/^[a-z][a-z0-9_.]{0,79}$/.test(r.event)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.timestamp??'')){invalid++;continue}
   // Never return raw log fields, exception text, paths, URLs or credentials.
   const event=/^(?:message|turn|rpc|service|wechat|delivery|receipt|inbox|output|media|setup)\.[a-z_.]{1,60}$/.test(r.event)?r.event:'other'
   records++;counts[event]=(counts[event]??0)+1;last=r.timestamp
   if(Number.isSafeInteger(r.dropped)&&r.dropped>0)dropped+=r.dropped
   const trace=typeof r.trace_id==='string'?hash(r.trace_id):null
   if(event==='turn.started'&&trace)active.set(trace,{trace_ref:trace,started_at:r.timestamp})
   if(event==='turn.completed'||event==='rpc.closed')active.delete(trace)
   if(event==='service.started'||event==='service.stopping')active.clear()
   if(r.level==='error'){failures.push({timestamp:r.timestamp,event,...(knownCodes.has(r.code)?{code:r.code}:{}),...(trace?{trace_ref:trace}:{})});if(failures.length>20)failures.shift()}
  }
 }
 return {files,records,last_event_at:last,invalid_lines:invalid,dropped_records:dropped,counts,recent_failures:failures,unmatched_turns:[...active.values()].slice(-20),unmatched_turn_count:active.size}
}
export async function handleDiagnostic(action,reply,{stateDir=accountPaths().stateDir,service=accountPaths().service,services=new ServiceManager(),outputDir=resolve('outputs','diagnostics')}={}){
 try{
  let status
  if(action!=='errors')try{status=await services.status(service)}catch{status={unknown:true}}
  const serviceText=()=>status?.unknown?'服务状态：未能查询。':`服务状态：${status.active?'运行中':'未运行或状态查询失败'}${status.pid?`，PID ${status.pid}`:''}。`
  if(action==='service'){await reply(serviceText());return}
  const data=await readDiagnostics(join(stateDir,'logs'))
  const errors=data.recent_failures.map(r=>`${r.timestamp} ${r.event}${r.code?' '+r.code:''}`)
  const summary=`诊断范围：当前机器人账号保留的本地日志。\n${data.files?`共 ${data.records} 条记录，最近事件：${data.last_event_at??'无'}。`:'暂无诊断日志，不能据此判断运行正常。'}\n最近错误：${errors.length} 条（最多展示20条）；未匹配结束事件：${data.unmatched_turn_count} 个（不等于任务仍在执行）。\n无效日志行：${data.invalid_lines}；记录丢弃：${data.dropped_records}。`
  if(action==='errors'){await reply(errors.length?'最近错误（最多20条）：\n'+errors.join('\n'):data.files?'保留的诊断日志中未发现错误级别事件。':'暂无诊断日志，无法查询最近错误。');return}
  if(action==='export'){
   await mkdir(outputDir,{recursive:true,mode:0o700})
   const path=join(outputDir,`diagnostic-${randomUUID()}.json`)
   await writeFile(path,JSON.stringify({generated_at:new Date().toISOString(),scope:'Current account local diagnostic events only. API acceptance is not proof of reading. Unmatched events do not prove a task is running.',service:{active:status.unknown?null:!!status.active,pid:status.pid??null},...data},null,2)+'\n',{mode:0o600,flag:'wx'})
   await reply(`${serviceText()}\n${summary}\n[下载脱敏诊断报告](<${path}>)`);return
  }
  await reply(serviceText()+'\n'+summary+'\n接口接受不代表已读；日志统计不能证明模型推理可用。')
 }catch{await reply('诊断未完成：无法读取诊断记录或生成报告。未修改服务、配置或任务，请通过终端检查文件权限与磁盘空间。')}
}
