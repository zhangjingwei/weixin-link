import {createHash} from 'node:crypto'
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
 const {remoteConfigStatus}=await import('../../infrastructure/remote/host-config.mjs')
 const config=remoteConfigStatus()
 if(!config.valid){
  if(action==='activate')return {stop_confirmed:true,tasks:[],remoteDisabled:true,error:config.error}
  try{const {RemoteStore}=await import('../../infrastructure/storage/registry-lock.mjs'),state=await new RemoteStore(cwd).read(),scope=createHash('sha256').update(threadId).digest('hex').slice(0,24);const outstanding=Object.values(state).some(t=>t?.kind==='official-remote-task'&&t.scope===scope&&!t.stop_confirmed);return {stop_confirmed:!outstanding,tasks:[],remoteDisabled:true,error:config.error}}catch{return {stop_confirmed:false,tasks:[],remoteDisabled:true,error:'REMOTE_STATE_UNREADABLE'}}
 }
 const {RemoteController}=await import('./remote-controller.mjs')
 const controller=new RemoteController({root:cwd,scope:threadId})
 return controller.run({action:action==='activate'?'activate':action==='seal'?'seal':'stop-scope'})
}
