import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {accountPaths} from '../../infrastructure/accounts/account-store.mjs'
const commands={'诊断':'diagnose',diagnose:'diagnose','服务状态':'service','service-status':'service','查看最近错误':'errors','recent-errors':'errors','导出诊断报告':'export','export-diagnostics':'export'}
export const diagnosticCommand=text=>typeof text==='string'?commands[text.trim().toLowerCase()]??null:null
const knownCodes=new Set(['EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOENT','EACCES','ENOSPC','EIO','ABORT_ERR'])
const apiReasons=new Set(['prepare_failed','unknown_error'])
const deliveryStates=new Set(['failed','partial','unknown','cancelled','accepted','deferred'])
const errorKinds=new Set(['wechat_api','wechat_auth','wechat_context','wechat_transport','timeout','delivery_exception'])
const sendStages={'outbound.text_failed':'text','outbound.media_failed':'media','outbound.attachment_prepare_failed':'attachment_prepare','delivery.failed':'delivery'}
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12)
function sendFields(record){
 const fields={stage:sendStages[record.event]}
 if(Number.isSafeInteger(record.http_status)&&record.http_status>=100&&record.http_status<=599)fields.http_status=record.http_status
 if(Number.isSafeInteger(record.api_code))fields.api_code=record.api_code
 if(apiReasons.has(record.api_reason))fields.api_reason=record.api_reason
 if(deliveryStates.has(record.delivery_state))fields.delivery_state=record.delivery_state
 if(errorKinds.has(record.error_kind))fields.error_kind=record.error_kind
 if(Number.isSafeInteger(record.part)&&record.part>0&&record.part<=100)fields.part=record.part
 if(Number.isSafeInteger(record.parts)&&record.parts>0&&record.parts<=100)fields.parts=record.parts
 return fields
}
function failureText(failure){
 const stage={text:'文本发送',media:'媒体发送',attachment_prepare:'附件准备',delivery:'投递'}[failure.stage]
 const reason={prepare_failed:'消息准备失败',unknown_error:'未知错误'}[failure.api_reason]
 const kind={wechat_api:'微信接口拒绝',wechat_auth:'微信授权异常',wechat_context:'微信会话上下文不可用',wechat_transport:'微信连接异常',timeout:'请求超时',delivery_exception:'投递异常'}[failure.error_kind]
 const state={failed:'失败',partial:'部分成功',unknown:'结果待确认',cancelled:'已取消',accepted:'接口已接受',deferred:'待发送'}[failure.delivery_state]
 return `${failure.timestamp} ${failure.event}${stage?'（'+stage+'）':''}${failure.code?' '+failure.code:''}${failure.http_status?' HTTP '+failure.http_status:''}${failure.api_code!==undefined?' 微信返回码 '+failure.api_code:''}${reason?'（'+reason+'）':kind?'（'+kind+'）':failure.api_code!==undefined?'（原因未提供）':''}${state?' 投递：'+state:''}${failure.attempts_observed?' 尝试记录：'+failure.attempts_observed+' 次':''}${failure.trace_ref?' trace_ref='+failure.trace_ref:''}`
}
export async function readDiagnostics(dir){
 const counts={},failures=[],active=new Map(),lastSendByTrace=new Map();let records=0,invalid=0,last=null,dropped=0,files=0
 for(const name of ['events.jsonl.5','events.jsonl.4','events.jsonl.3','events.jsonl.2','events.jsonl.1','events.jsonl']){
  let data;try{data=await readFile(join(dir,name),'utf8');files++}catch(e){if(e.code==='ENOENT')continue;throw e}
  for(const line of data.split('\n').filter(Boolean)){
   let r;try{r=JSON.parse(line)}catch{invalid++;continue}
   if(!r||typeof r!=='object'||typeof r.event!=='string'||!/^[a-z][a-z0-9_.]{0,79}$/.test(r.event)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.timestamp??'')){invalid++;continue}
   // Never return raw log fields, exception text, paths, URLs or credentials.
   const event=/^(?:message|turn|rpc|service|wechat|delivery|receipt|inbox|output|outbound|ingress|attachments|media|setup)\.[a-z_.]{1,60}$/.test(r.event)?r.event:'other'
   records++;counts[event]=(counts[event]??0)+1;last=r.timestamp
   if(Number.isSafeInteger(r.dropped)&&r.dropped>0)dropped+=r.dropped
   const trace=typeof r.trace_id==='string'?hash(r.trace_id):null
   if(event==='turn.started'&&trace)active.set(trace,{trace_ref:trace,started_at:r.timestamp})
   if(event==='turn.completed'||event==='rpc.closed')active.delete(trace)
   if(event==='service.started'||event==='service.stopping')active.clear()
   if(r.level==='error'){
    const base={timestamp:r.timestamp,event,...(knownCodes.has(r.code)?{code:r.code}:{}),...(trace?{trace_ref:trace}:{})}
    if(event==='outbound.text_failed'||event==='outbound.media_failed'){
     const previous=trace?lastSendByTrace.get(trace):null
     const repeat=previous&&previous.event===event&&previous.part===r.part&&previous.parts===r.parts&&
       previous.final_attempt===false&&r.attempt>1&&Number.isSafeInteger(r.attempt)
     if(repeat){
      previous.timestamp=r.timestamp
      previous.attempts_observed++
      previous.final_attempt=r.final_attempt===true
      Object.assign(previous,sendFields(r))
     }else{
      const failure={...base,...sendFields(r),attempts_observed:1,final_attempt:r.final_attempt===true}
      failures.push(failure)
      if(trace)lastSendByTrace.set(trace,failure)
     }
    }else if(event==='delivery.failed'){
     const previous=trace?lastSendByTrace.get(trace):null
     if(previous&&!previous.delivery_recorded&&Date.parse(r.timestamp)-Date.parse(previous.timestamp)>=0&&
       Date.parse(r.timestamp)-Date.parse(previous.timestamp)<=10_000){
      previous.delivery_recorded=true
      previous.timestamp=r.timestamp
      const fields=sendFields(r);delete fields.stage
      Object.assign(previous,fields)
     }else failures.push({...base,...sendFields(r)})
    }else failures.push(event in sendStages?{...base,...sendFields(r)}:base)
   }
  }
 }
 return {files,records,last_event_at:last,invalid_lines:invalid,dropped_records:dropped,counts,recent_failures:failures.slice(-20).map(({final_attempt,delivery_recorded,...failure})=>failure),unmatched_turns:[...active.values()].slice(-20),unmatched_turn_count:active.size}
}
export async function handleDiagnostic(action,reply,{stateDir=accountPaths().stateDir,service=accountPaths().service,services,outputDir=resolve('outputs','diagnostics')}={}){
 try{
  let status
  if(action!=='errors')try{status=services?await services.status(service):{unknown:true}}catch{status={unknown:true}}
  const serviceText=()=>status?.unknown?'服务状态：未能查询。':`服务状态：${status.active?'运行中':'未运行或状态查询失败'}${status.pid?`，PID ${status.pid}`:''}。`
  if(action==='service'){await reply(serviceText());return}
  const data=await readDiagnostics(join(stateDir,'logs'))
  const errors=data.recent_failures.map(failureText)
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
