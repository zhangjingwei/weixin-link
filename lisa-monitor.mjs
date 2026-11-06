import {spawn} from 'node:child_process'
import {readFile,writeFile,rename,mkdir,appendFile,stat,rm,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {accountPaths} from './accounts.mjs'
import {controlRequest} from './runtime-control.mjs'
import {chinaDate} from './scheduled-delivery.mjs'

const hostHome=process.env.HOME
const rotationCooldownMs=30*60*1000
const infrastructureReasons=new Set(['probe_execution_failed','probe_client_exited'])

export function combineProbe(proxy,domesticOk=true){
 const ok=domesticOk&&proxy?.ok===true
 return {...proxy,ok,domesticOk,realityOk:proxy?.ok===true,reason:proxy?.reason??'proxy_probe_unavailable'}
}
export function transition(prev={},sample){
 const state={...prev,checkedAt:sample.time??prev.checkedAt,fail:sample.ok?0:(prev.fail??0)+1,success:sample.ok?(prev.success??0)+1:0}
 let event=null
 if(!sample.ok&&state.fail>=3&&!prev.incident){state.incident=sample.time;event='fault'}
 if(sample.ok&&prev.incident&&state.success>=3){event='recovery';delete state.incident}
 return {state,event}
}
export function recordOutcome(prev={},sample,{domesticOk=true,trusted=true,time}={}){
 const skipped=infrastructureReasons.has(sample.reason)?'probe_infrastructure':(!trusted?'remote_unavailable':(!domesticOk?'domestic_unavailable':null))
 if(skipped)return {state:{...prev,checkedAt:time??prev.checkedAt,fail:0,success:0,skipped},event:null}
 return transition(prev,{...sample,time:time??sample.time??new Date().toISOString()})
}
export function recoveryDigest(state,now,expectedPorts=[]){
 const missed=state.notifications.filter(n=>n.event!=='digest'&&['unknown','attempted','failed','partial'].includes(n.status)&&!n.digestId)
 if(!missed.length||!expectedPorts.length||!expectedPorts.every(p=>(state.ports[p]?.success??0)>=3))return null
 const id='lisa-monitor-summary-'+Date.parse(now)
 for(const n of missed)n.digestId=id
 return {id,event:'digest',status:'pending',sources:missed.map(n=>n.id),text:'【lisa监控恢复后补报】\n此前'+missed.length+'条故障/恢复通知未确认送达，现合并说明；原消息不会重发。\n'+missed.map(n=>n.text.replace(/[⚠️✅]/gu,'')).join('\n---\n').slice(0,4000)+'\n当前端口已连续3轮通过REALITY代理验证。此摘要不代表此前消息已送达。'}
}

function run(command,args,{input=null,timeoutMs=30000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],env:process.env})
  let stdout='',stderr='',settled=false,size=0
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value)}
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Object.assign(Error('PROCESS_TIMEOUT'),{code:'ETIMEDOUT'}))},timeoutMs)
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576){child.kill('SIGKILL');finish(Error('PROCESS_OUTPUT_TOO_LARGE'))}else stdout+=chunk})
  child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk})
  child.stdin.on('error',()=>{})
  child.once('error',error=>finish(error))
  child.once('exit',code=>code===0?finish(null,{stdout,stderr}):finish(Object.assign(Error('PROCESS_FAILED'),{code:'PROCESS_EXIT_'+code})))
  if(input!==null)child.stdin.end(input)
  else child.stdin.end()
 })
}
async function remoteRequest(request){
 const path=process.env.WECHAT_MONITOR_CONFIG??join(hostHome,'.config/wechat-assistant/monitor.json')
 const config=await readJson(path,null)
 if(!config||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.host??''))throw Error('MONITOR_CONFIG_REQUIRED_OR_INVALID')
 const args=['-F',process.env.WECHAT_SSH_CONFIG??join(hostHome,'.ssh/wechat_hosts_config'),'-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=6',config.host]
 const {stdout}=await run('ssh',args,{input:JSON.stringify(request),timeoutMs:65000})
 return JSON.parse(stdout)
}
async function probeReport(path,rounds=1){
 const {stdout}=await run('python3',[join(import.meta.dirname,'lisa-proxy-probe.py'),'--report',path,String(rounds)],{timeoutMs:50000})
 const report=JSON.parse(stdout)
 if(report?.error)throw Error(report.error)
 return report
}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw error}}
async function atomic(path,value){const temp=path+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await chmod(temp,0o600);await rename(temp,path)}
function validProxies(proxies){
 return Array.isArray(proxies)&&proxies.length>0&&proxies.length<=16&&proxies.every(p=>typeof p?.tag==='string'&&typeof p.server==='string'&&Number.isInteger(p.port)&&p.port>0&&p.port<65536&&typeof p.uuid==='string'&&typeof p.serverName==='string'&&typeof p.publicKey==='string'&&typeof p.shortId==='string')
}
export function candidateByTag(proxies,tag){
 const candidate=Array.isArray(proxies)?proxies.find(p=>p.tag===tag):undefined
 if(!candidate)throw Error('ROTATION_CANDIDATE_MISSING')
 return candidate
}
async function probeCandidate(proxies,tag,path,rounds=2){
 const candidate=candidateByTag(proxies,tag)
 const candidatePath=join(path,'rotation-candidate.json')
 try{
  await atomic(candidatePath,{proxies:[candidate]})
  const report=await probeReport(candidatePath,rounds)
  if(!report.domestic?.ok)throw Error('ROTATION_DOMESTIC_FAILED')
  const result=report.results.find(x=>x.port===candidate.port)
  if(!result?.ok)throw Error('ROTATION_CANDIDATE_FAILED')
  return result
 }finally{await rm(candidatePath,{force:true})}
}

async function main(){
 const paths=accountPaths(),monitorDir=join(paths.stateDir,'lisa-monitor'),rotationDir=join(paths.stateDir,'lisa-port-watch')
 await Promise.all([mkdir(monitorDir,{recursive:true,mode:0o700}),mkdir(rotationDir,{recursive:true,mode:0o700})])
 const probePath=join(monitorDir,'probe.json'),statePath=join(monitorDir,'state.json'),log=join(monitorDir,'events.jsonl'),rotationPath=join(rotationDir,'state.json')
 let remote=null,remoteError=false
 try{remote=await remoteRequest({action:'snapshot'})}catch{remoteError=true}
 let proxies=[]
 if(remote&&validProxies(remote.proxies)){
  proxies=remote.proxies
  await atomic(probePath,{proxies})
 }else{
  try{proxies=JSON.parse(await readFile(probePath,'utf8')).proxies??[]}catch{}
 }
 if(!validProxies(proxies))throw Error('INVALID_MONITOR_PROXIES')
 const state=await readJson(statePath,{ports:{},notifications:[]});state.ports??={};state.notifications??=[]
 for(const n of state.notifications)if(n.status==='attempted')n.status='unknown'
 const rotationState=await readJson(rotationPath,{})
 const now=new Date(),iso=now.toISOString()
 const trusted=!!remote&&remote.active===true&&remote.pending!==true&&!remoteError
 let report=null,probeError=false
 if(trusted){
  try{report=await probeReport(probePath,1)}catch{probeError=true}
 }
 const outcomes=[]
 if(report?.domestic?.ok){
  for(const proxy of proxies){
   const result=report.results.find(x=>x.port===proxy.port)
   const sample=result?combineProbe(result,true):combineProbe({port:proxy.port,ok:false,reason:'probe_execution_failed',targets:[]},true)
   const previous=state.ports[proxy.port]??{}
   const next=recordOutcome(previous,sample,{domesticOk:true,trusted:true,time:iso})
   state.ports[proxy.port]=next.state
   outcomes.push(sample)
   if(next.event){
    const evidence=`远端节点服务：${remote.active?'active':'未激活'}；远端事务：${remote.pending?'pending':'idle'}`
    state.notifications.push({id:'lisa-monitor-'+Date.now()+'-'+proxy.port,event:next.event,text:next.event==='fault'?`⚠️ lisa节点异常\n端口${proxy.port}连续3轮REALITY/HTTPS验证失败。\n验证目标：${(sample.targets??[]).map(x=>x.target).join('、')||'unknown'}；原因：${sample.reason}。\n${evidence}\n其他端口：${proxies.filter(y=>y.port!==proxy.port).map(y=>y.port+' '+(state.ports[y.port]?.fail?'失败中':'正常')).join('、')}\n检测时间：${iso}`:`✅ lisa节点恢复\n端口${proxy.port}连续3轮REALITY代理验证成功。\n原故障开始：${previous.incident}\n恢复确认：${iso}`,status:'pending'})
   }
  }
 }else{
  const reason=!trusted?'proxy_https_failed':(probeError?'probe_execution_failed':'proxy_https_failed')
  const sample={ok:false,reason,targets:[]}
  for(const proxy of proxies){
   const previous=state.ports[proxy.port]??{}
   const next=recordOutcome(previous,sample,{domesticOk:report?.domestic?.ok===true,trusted,time:iso})
   state.ports[proxy.port]=next.state
   outcomes.push({port:proxy.port,...sample,skipped:next.state.skipped})
  }
 }
 const faulted=proxies.find(p=>state.ports[p.port]?.incident)
 const lastRotation=Math.max(Number(rotationState.last_attempt??0),Number(remote?.last_rotation??0)*1000)
 if(faulted&&report?.domestic?.ok&&remote?.active===true&&remote?.pending!==true&&now.getTime()-lastRotation>=rotationCooldownMs){
  rotationState.last_attempt=now.getTime()
  await atomic(rotationPath,rotationState)
  let token=null
  try{
   const stage=await remoteRequest({action:'stage',port:faulted.port})
   token=stage.token
   if(!validProxies(stage.proxies))throw Error('ROTATION_CONFIG_INVALID')
   const stagedCandidate=candidateByTag(stage.proxies,faulted.tag)
   if(stagedCandidate.port!==Number(stage.new))throw Error('ROTATION_CANDIDATE_PORT_MISMATCH')
   const candidate=await probeCandidate(stage.proxies,faulted.tag,monitorDir)
   const committed=await remoteRequest({action:'commit',token})
   if(!validProxies(committed.proxies))throw Error('ROTATION_COMMIT_INVALID')
   await atomic(probePath,{proxies:committed.proxies})
   state.ports[faulted.port]={...state.ports[faulted.port],rotatedTo:stage.new,checkedAt:iso}
   rotationState.last_change=now.getTime();rotationState.last_change_iso=iso;rotationState.old=stage.old;rotationState.new=stage.new
   await atomic(rotationPath,rotationState)
   state.notifications.push({id:'lisa-monitor-'+Date.now()+'-rotation',event:'rotation',status:'pending',text:`✅ lisa端口已切换\n旧端口：${stage.old}\n新端口：${stage.new}\n切换前国内HTTPS正常，新端口已通过${candidate.targets?.length??2}个国外目标验证。\n切换时间：${iso}`})
  }catch{
   if(token)try{await remoteRequest({action:'rollback',token})}catch{}
   rotationState.last_failure=now.getTime()
   await atomic(rotationPath,rotationState)
  }
 }
 try{if((await stat(log)).size>1048576)await rename(log,log+'.1')}catch(error){if(error.code!=='ENOENT')throw error}
 await appendFile(log,JSON.stringify({time:iso,remote:remote?{active:remote.active,pending:remote.pending}:{error:'unavailable'},domestic:report?.domestic??null,outcomes})+'\n',{mode:0o600})
 if(!report?.domestic?.ok&&remoteError===false&&remote?.active===true)state.domestic={fail:(state.domestic?.fail??0)+1,checkedAt:iso,targets:report?.domestic?.targets??[]}
 if(report?.domestic?.ok)state.domestic={fail:0,success:(state.domestic?.success??0)+1,checkedAt:iso,targets:report.domestic.targets}
 await atomic(statePath,state)

 let channelReady=false
 try{const r=await fetch('https://ilinkai.weixin.qq.com/',{method:'HEAD',signal:AbortSignal.timeout(5000)});channelReady=r.status>0&&(await controlRequest(paths.socket,'GET','/status',undefined,3000)).ready}catch{}
 const currentPorts=proxies.map(p=>p.port)
 if(channelReady){const digest=recoveryDigest(state,iso,currentPorts);if(digest)state.notifications.push(digest)}
 await atomic(statePath,state)
 for(const n of state.notifications.filter(n=>channelReady&&n.status==='pending')){
  const configPath=join(paths.stateDir,'notification-jobs.json'),cfg=JSON.parse(await readFile(configPath,'utf8')),owners=JSON.parse(await readFile(join(paths.stateDir,'codex-owners.json'),'utf8'))
  if(owners.length!==1)throw Error('MONITOR_RECIPIENT_AMBIGUOUS')
  cfg.jobs=cfg.jobs.filter(j=>!j.id.startsWith('lisa-monitor-')||Date.now()-Number(j.createdAt??0)<7*86400000)
  cfg.jobs.push({id:n.id,kind:'node-alert',enabled:true,recipient:owners[0],createdAt:Date.now()})
  await writeFile(configPath+'.monitor.tmp',JSON.stringify(cfg,null,2)+'\n',{mode:0o600});await rename(configPath+'.monitor.tmp',configPath)
  n.status='attempted';await atomic(statePath,state)
  try{const r=await controlRequest(paths.socket,'POST','/scheduled-text',{jobId:n.id,occurrence:chinaDate(new Date()),text:n.text},15000);n.status=r.accepted?'accepted':r.state??'unknown'}catch{n.status='unknown'}
  await atomic(statePath,state)
 }
 state.notifications=state.notifications.slice(-100)
 await atomic(statePath,state)
 console.log(JSON.stringify({remote:remote?{active:remote.active,pending:remote.pending}:{error:'unavailable'},domestic:report?.domestic??null,ports:proxies.map(p=>({port:p.port,fail:state.ports[p.port]?.fail??0,success:state.ports[p.port]?.success??0,incident:!!state.ports[p.port]?.incident})),notifications:state.notifications.slice(-3).map(x=>({event:x.event,status:x.status}))}))
}
if(process.argv[1]?.endsWith('/lisa-monitor.mjs'))main().catch(()=>{console.error('LISA_MONITOR_FAILED');process.exitCode=1})
