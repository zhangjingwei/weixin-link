import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {userHome} from './platform-service.mjs'
import {standardDeployment} from './upgrade.mjs'
import {readChatUpgrade,saveChatUpgrade} from './chat-upgrade.mjs'

import {releaseTag} from '../domain/updates/release-version.mjs'
import {nodeEnvironment} from './platform-command.mjs'
const exec=promisify(execFile)
export function upgradeFailureCode(error){
 const known=['ENOENT','EACCES','ETIMEDOUT','NPM_CLI_NOT_FOUND']
 if(known.includes(error.code))return error.code
 if(/^CHAT_UPGRADE_[A-Z_]+$/.test(error.message??''))return error.message
 const match=String(error.stderr??'').match(/^错误代码：(UPGRADE_[A-Z_]+|NPM_CLI_NOT_FOUND)$/m)
 return match?.[1]??'CHAT_UPGRADE_FAILED'
}
export async function performChatUpgrade({home=userHome(),target=fileURLToPath(new URL('../../',import.meta.url)),requestId,read=readChatUpgrade,save=saveChatUpgrade,deployment=standardDeployment,run=exec,wait=delay,attempts=600}={}){
 const request=await read(home)
 if(request?.id!==requestId||request.status!=='waiting_idle')throw Error('CHAT_UPGRADE_REQUEST_CHANGED')
 let stage='waiting_idle'
 try{
  if(!releaseTag(request.tag))throw Error('CHAT_UPGRADE_RELEASE_REQUIRED')
  for(let attempt=0;attempt<attempts;attempt++){
   if((await read(home))?.id!==requestId)throw Error('CHAT_UPGRADE_REQUEST_CHANGED')
   const adapter=await deployment({target,home})
   const active=adapter.services.filter(service=>service.active)
   if(!active.length)throw Error('CHAT_UPGRADE_SERVICE_UNAVAILABLE')
   const states=await Promise.all(active.map(service=>adapter.status(service)))
   if(states.some(state=>!state.ready||!state.idle||state.draining)){await wait(1000);continue}
   stage='installer';await save(home,{...request,status:'running',stage})
   try{
    await run(process.platform==='win32'?'powershell.exe':'/bin/sh',process.platform==='win32'?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(target,'install.ps1')]:[join(target,'install.sh')],{cwd:target,env:{...nodeEnvironment(),HOME:home,WEIXIN_LINK_DIR:target,WEIXIN_LINK_UPGRADE_TRACE_ID:request.trace_id??'',WEIXIN_LINK_REF:request.tag,WEIXIN_LINK_EXPECTED_COMMIT:request.commit},timeout:900000,maxBuffer:1024*1024})
   }catch(error){
    if(upgradeFailureCode(error)==='UPGRADE_BUSY'){await save(home,request);await wait(1000);continue}
    throw error
   }
   stage='verify_version'
   const marker=JSON.parse(await readFile(join(target,'.weixin-link-release.json'),'utf8'))
   if(marker?.ref!==request.tag||marker.repository!=='zhangjingwei/weixin-link'||!/^[0-9a-f]{7,40}$/.test(marker.commit??'')||!request.commit.startsWith(marker.commit))throw Error('CHAT_UPGRADE_VERSION_UNVERIFIED')
   stage='verify_health'
   const after=await deployment({target,home})
   for(const service of active){const current=after.services.find(item=>item.id===service.id);if(!current?.active||(await after.status(current)).ready!==true)throw Error('CHAT_UPGRADE_HEALTH_UNVERIFIED')}
   await save(home,{...request,status:'complete',stage:'complete',installedVersion:request.tag,installedCommit:marker.commit})
   return {status:'complete',version:request.tag,commit:marker.commit}
  }
  throw Error('CHAT_UPGRADE_REMAINED_BUSY')
 }catch(error){if((await read(home))?.id===requestId)await save(home,{...request,status:'failed',stage,error:upgradeFailureCode(error)});throw error}
}

if(process.argv[1]&&process.argv[1].endsWith('/chat-upgrade-worker.mjs')){
 const home=userHome(),requestId=process.argv[2]
 try{await performChatUpgrade({home,requestId,target:process.argv[3]})}catch{process.exitCode=1}
 finally{if(process.platform==='darwin')await unlink(join(home,'.local/share/weixin-link/chat-upgrade-'+requestId+'.plist')).catch(()=>{})}
}
