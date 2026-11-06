import {access} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
export async function remoteScope(cwd,threadId,action){
 if(!threadId)return {stop_confirmed:true,tasks:[]}
 const path=join(cwd,'remote-controller.mjs')
 try{await access(path)}catch(e){if(e.code==='ENOENT')return {stop_confirmed:true,tasks:[]};throw e}
 const {RemoteController}=await import(pathToFileURL(path).href)
 const controller=new RemoteController({root:cwd,scope:threadId})
 return action==='activate'?controller.activate():action==='seal'?controller.seal():controller.stopScope()
}
