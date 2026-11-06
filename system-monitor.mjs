import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile,rename,mkdir,appendFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {accountPaths} from './accounts.mjs'
import {controlRequest} from './runtime-control.mjs'
import {chinaDate} from './scheduled-delivery.mjs'
const exec=promisify(execFile)
export function evaluate(prev,s){
 const state=structuredClone(prev),events=[]
 if(state.boot!==s.boot){state.boot=s.boot;state.historySeen=false}
 state.hotCount=s.temp>=75?(state.hotCount??0)+1:0
 if(!state.hot&&(s.temp>=80||state.hotCount>=2)){state.hot=true;state.coolCount=0;events.push('高温告警')}
 if(state.hot){state.coolCount=s.temp<=70?(state.coolCount??0)+1:0;if(state.coolCount>=3){state.hot=false;events.push('温度恢复')}}
 if(s.flags&1){if(!state.under)events.push('当前供电欠压');state.under=true;state.voltageGood=0}
 else if(state.under){state.voltageGood=(state.voltageGood??0)+1;if(state.voltageGood>=3){state.under=false;events.push('供电欠压恢复')}}
 if((s.flags&0x10000)&&!state.historySeen){state.historySeen=true;if(!(s.flags&1))events.push('本次启动曾发生欠压（当前已恢复，发生时间未知）')}
 return {state,events}
}
async function main(){
 const p=accountPaths(),dir=join(p.stateDir,'system-monitor');await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,'state.json');let data={health:{},notifications:[]};try{data=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 const save=async()=>{await writeFile(path+'.tmp',JSON.stringify(data),{mode:0o600});await rename(path+'.tmp',path)}
 const run=async arg=>(await exec('vcgencmd',[arg],{timeout:3000})).stdout
 const [temperature,throttled,boot]=await Promise.all([run('measure_temp'),run('get_throttled'),readFile('/proc/sys/kernel/random/boot_id','utf8')]);const temp=Number(temperature.match(/=([\d.]+)/)?.[1]),hex=throttled.match(/0x[\da-f]+/i)?.[0];if(!Number.isFinite(temp)||!hex)throw Error('INVALID_SENSOR_DATA')
 let voltage=null;try{voltage=Number((await run('pmic_read_adc')).match(/EXT5V_V\s+volt\(\d+\)=([\d.]+)V/)?.[1]);if(!Number.isFinite(voltage))voltage=null}catch{}
 const sample={time:new Date().toISOString(),boot:boot.trim(),temp,flags:parseInt(hex,16),voltage};const next=evaluate(data.health,sample);data.health=next.state
 for(const title of next.events)data.notifications.push({id:'system-monitor-'+Date.now()+'-'+data.notifications.length,status:'pending',text:`【树莓派系统监控】${title}\n温度：${temp}℃\n5V输入采样：${voltage===null?'不可用':voltage.toFixed(3)+'V'}\n固件标志：${hex}\n时间：${sample.time}\n欠压依据为固件检测标志；瞬时电压不代表故障期间最低值。`})
 const log=join(dir,'samples.jsonl');try{if((await stat(log)).size>1048576)await rename(log,log+'.1')}catch(e){if(e.code!=='ENOENT')throw e}await appendFile(log,JSON.stringify(sample)+'\n',{mode:0o600});await save()
 let ready=false;try{ready=(await controlRequest(p.socket,'GET','/status',undefined,3000)).ready;await fetch('https://ilinkai.weixin.qq.com/',{method:'HEAD',signal:AbortSignal.timeout(5000)})}catch{ready=false}
 // Unknown deliveries are summarized once, never blindly replayed.
 const missed=data.notifications.filter(n=>['unknown','attempted','failed','partial'].includes(n.status)&&!n.summaryOf&&!n.summarized)
 if(ready&&missed.length){const id='system-monitor-summary-'+Date.now();for(const n of missed)n.summarized=id;data.notifications.push({id,status:'pending',summaryOf:missed.map(n=>n.id),text:'【树莓派监控恢复后补报】此前通知未确认送达，以下为合并摘要，原消息不重发。\n'+missed.map(n=>n.text).join('\n').slice(0,4500)})}
 await save()
 for(const n of data.notifications.filter(n=>ready&&n.status==='pending')){
  const config=join(p.stateDir,'notification-jobs.json'),c=JSON.parse(await readFile(config,'utf8')),owners=JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8'));if(owners.length!==1)throw Error('AMBIGUOUS_RECIPIENT')
  c.jobs=c.jobs.filter(j=>!j.id.startsWith('system-monitor-')||Date.now()-Number(j.createdAt??0)<7*86400000);c.jobs.push({id:n.id,kind:'system-alert',enabled:true,recipient:owners[0],createdAt:Date.now()});await writeFile(config+'.system.tmp',JSON.stringify(c,null,2)+'\n',{mode:0o600});await rename(config+'.system.tmp',config)
  n.status='attempted';await save();try{const r=await controlRequest(p.socket,'POST','/scheduled-text',{jobId:n.id,occurrence:chinaDate(new Date()),text:n.text},15000);n.status=r.accepted?'accepted':r.state??'unknown'}catch{n.status='unknown'}await save()
 }
 data.notifications=data.notifications.slice(-100);await save();console.log(JSON.stringify({sample,events:next.events,notifications:data.notifications.slice(-3).map(n=>({id:n.id,status:n.status}))}))
}
if(process.argv[1]?.endsWith('/system-monitor.mjs'))main().catch(()=>{console.error('SYSTEM_MONITOR_FAILED');process.exitCode=1})
