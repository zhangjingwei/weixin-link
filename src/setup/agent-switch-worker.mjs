import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {unlink} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {accountPaths,assertAccount} from '../wechat/accounts.mjs'
import {installConfig} from './install-config.mjs'
import {standardDeployment} from './upgrade.mjs'
import {readAgentSwitch,saveAgentSwitch} from './agent-switch.mjs'
import {writeAgentKind} from '../base/agent-selection.mjs'

export async function performAgentSwitch({account,requestId,root,home,read=readAgentSwitch,save=saveAgentSwitch,write=writeAgentKind,deployment=standardDeployment,wait=delay,attempts=600}={}){
 const request=await read(account)
 if(request?.id!==requestId||request.status!=='waiting_idle')throw Error('AGENT_SWITCH_REQUEST_CHANGED')
 const lease=randomUUID()
 let adapter,service,sealed=false,stopped=false,changed=false
 try{
  adapter=await deployment({target:root,home})
  service=adapter.services.find(item=>item.id===account.id)
  if(!service?.active)throw Error('AGENT_SWITCH_SERVICE_UNAVAILABLE')
  for(let attempt=0;attempt<attempts;attempt++){
   if((await read(account))?.id!==requestId)throw Error('AGENT_SWITCH_REQUEST_CHANGED')
   const current=await adapter.status(service)
   if(!current.ready||!current.idle||current.draining){await wait(1000);continue}
   const drained=await adapter.control(service,'drain',lease)
   if(!drained.idle){await adapter.control(service,'resume',lease);await wait(1000);continue}
   await adapter.control(service,'seal',lease);sealed=true
   break
  }
  if(!sealed)throw Error('AGENT_SWITCH_REMAINED_BUSY')
  await save(account,{...request,status:'committing'})
  stopped=true;await adapter.stop(service)
  changed=true;await write(account,request.target)
  await adapter.start(service)
  for(let attempt=0;attempt<30;attempt++){
   try{const state=await adapter.status(service);if(state.ready&&state.backend?.agentKind===request.target){await save(account,{...request,status:'complete'});return {status:'complete',agentKind:request.target}}}catch{}
   await wait(1000)
  }
  throw Error('AGENT_SWITCH_HEALTH_CHECK_FAILED')
 }catch(error){
  if(stopped){
   try{
    await adapter.stop(service)
    if(changed)await write(account,request.previous)
    await adapter.start(service)
    let healthy=false
    for(let attempt=0;attempt<30;attempt++){
     try{const state=await adapter.status(service);if(state.ready&&state.backend?.agentKind===request.previous){healthy=true;break}}catch{}
     await wait(1000)
    }
    if(!healthy)throw Error('AGENT_SWITCH_ROLLBACK_UNCONFIRMED')
   }catch{await save(account,{...request,status:'failed',error:'AGENT_SWITCH_ROLLBACK_UNCONFIRMED'});throw Error('AGENT_SWITCH_ROLLBACK_UNCONFIRMED')}
  }else if(sealed){try{await adapter.control(service,'resume',lease)}catch{}}
  await save(account,{...request,status:'failed',error:error.message})
  throw error
 }
}

if(process.argv[1]&&process.argv[1].endsWith('/agent-switch-worker.mjs')){
 const id=process.argv[2],requestId=process.argv[3],account=await assertAccount(id)
 try{await performAgentSwitch({account,requestId,root:fileURLToPath(new URL('../../',import.meta.url)),home:process.env.HOME})}
 catch{process.exitCode=1}
 finally{if(process.platform==='darwin')await unlink(join(account.stateDir,'agent-switch-'+requestId+'.plist')).catch(()=>{})}
}
