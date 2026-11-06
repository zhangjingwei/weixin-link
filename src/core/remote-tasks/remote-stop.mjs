import {access} from 'node:fs/promises'
import {join} from 'node:path'
export async function remoteScope(cwd,threadId,action){
 if(!threadId)return {stop_confirmed:true,tasks:[]}
 // Avoid creating remote state for installations that never enabled remote execution.
 let enabled=false
 for(const path of [join(cwd,'remote-controller.mjs'),join(cwd,'remote-sessions.json'),process.env.WECHAT_REMOTE_HOSTS??join(cwd,'remote-hosts.json')]){
  try{await access(path);enabled=true;break}catch(error){if(error.code!=='ENOENT')throw error}
 }
 if(!enabled)return {stop_confirmed:true,tasks:[]}
 const {RemoteController}=await import('./remote-controller.mjs')
 const controller=new RemoteController({root:cwd,scope:threadId})
 return action==='activate'?controller.activate():action==='seal'?controller.seal():controller.stopScope()
}
