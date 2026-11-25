import {readFile,lstat,mkdir,writeFile,rename,unlink} from 'node:fs/promises'
import {join,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
function validate(value){
 if(value?.version!==1||!['codex','claude'].includes(value.kind)||value.kind==='claude'&&(typeof value.binary!=='string'||!isAbsolute(value.binary)||/[\0\r\n]/.test(value.binary)))throw Error('INVALID_AGENT_SELECTION')
 if(value.claudeBinary!==undefined&&(typeof value.claudeBinary!=='string'||!isAbsolute(value.claudeBinary)||/[\0\r\n]/.test(value.claudeBinary)))throw Error('INVALID_AGENT_SELECTION')
 return {version:1,kind:value.kind,...value.kind==='claude'?{binary:value.binary}:{},...value.claudeBinary?{claudeBinary:value.claudeBinary}:{}}
}
export async function readAgentSelection(stateDir){
 const path=join(stateDir,'agent.json')
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096||(process.platform!=='win32'&&info.mode&0o077))throw Error('UNSAFE_AGENT_SELECTION');return validate(JSON.parse(await readFile(path,'utf8')))}catch(e){if(e.code==='ENOENT')return {version:1,kind:'codex'};throw e}
}
export async function saveAgentSelection(stateDir,value){
 const config=validate(value),path=join(stateDir,'agent.json'),temp=path+'.'+randomUUID()+'.tmp'
 await mkdir(stateDir,{recursive:true,mode:0o700})
 try{await writeFile(temp,JSON.stringify(config)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path)}finally{await unlink(temp).catch(()=>{})}
 return {kind:config.kind,restartRequired:true}
}
