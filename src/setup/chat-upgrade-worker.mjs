import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {userHome} from './platform-service.mjs'
import {standardDeployment} from './upgrade.mjs'
import {readChatUpgrade,saveChatUpgrade} from './chat-upgrade.mjs'

const exec=promisify(execFile)
export async function performChatUpgrade({home=userHome(),target=fileURLToPath(new URL('../../',import.meta.url)),requestId,read=readChatUpgrade,save=saveChatUpgrade,deployment=standardDeployment,run=exec,wait=delay,attempts=600}={}){
 const request=await read(home)
 if(request?.id!==requestId||request.status!=='waiting_idle')throw Error('CHAT_UPGRADE_REQUEST_CHANGED')
 try{
  for(let attempt=0;attempt<attempts;attempt++){
   if((await read(home))?.id!==requestId)throw Error('CHAT_UPGRADE_REQUEST_CHANGED')
   const adapter=await deployment({target,home})
   const active=adapter.services.filter(service=>service.active)
   if(!active.length)throw Error('CHAT_UPGRADE_SERVICE_UNAVAILABLE')
   const states=await Promise.all(active.map(service=>adapter.status(service)))
   if(states.some(state=>!state.ready||!state.idle||state.draining)){await wait(1000);continue}
   await save(home,{...request,status:'running'})
   try{
    await run(process.platform==='win32'?'powershell.exe':'/bin/sh',process.platform==='win32'?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(target,'install.ps1')]:[join(target,'install.sh')],{cwd:target,env:{...process.env,HOME:home,WEIXIN_LINK_DIR:target,WEIXIN_LINK_REF:'main'},timeout:900000,maxBuffer:1024*1024})
   }catch(error){
    if((error.stderr??'').includes('UPGRADE_BUSY')||(error.stdout??'').includes('UPGRADE_BUSY')){await save(home,request);await wait(1000);continue}
    throw error
   }
   const marker=JSON.parse(await readFile(join(target,'.weixin-link-release.json'),'utf8'))
   if(marker?.ref!=='main'||marker.repository!=='zhangjingwei/weixin-link'||!/^[0-9a-f]{7,40}$/.test(marker.commit??'')||marker.commit===request.previous)throw Error('CHAT_UPGRADE_VERSION_UNVERIFIED')
   const after=await deployment({target,home})
   for(const service of active){const current=after.services.find(item=>item.id===service.id);if(!current?.active||(await after.status(current)).ready!==true)throw Error('CHAT_UPGRADE_HEALTH_UNVERIFIED')}
   await save(home,{...request,status:'complete',installedCommit:marker.commit})
   return {status:'complete',commit:marker.commit}
  }
  throw Error('CHAT_UPGRADE_REMAINED_BUSY')
 }catch(error){if((await read(home))?.id===requestId)await save(home,{...request,status:'failed',error:/^CHAT_UPGRADE_[A-Z_]+$/.test(error.message)?error.message:'CHAT_UPGRADE_FAILED'});throw error}
}

if(process.argv[1]&&process.argv[1].endsWith('/chat-upgrade-worker.mjs')){
 const home=userHome(),requestId=process.argv[2]
 try{await performChatUpgrade({home,requestId})}catch{process.exitCode=1}
 finally{if(process.platform==='darwin')await unlink(join(home,'.local/share/weixin-link/chat-upgrade-'+requestId+'.plist')).catch(()=>{})}
}
