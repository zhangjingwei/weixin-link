import {readFile,lstat,mkdir,writeFile,rename,unlink} from 'node:fs/promises'
import {join,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
function validate(value){
 if(value?.version!==1||!['codex','claude','workbuddy','doubao','grok'].includes(value.kind)||['claude','workbuddy','doubao','grok'].includes(value.kind)&&(typeof value.binary!=='string'||!isAbsolute(value.binary)||/[\0\r\n]/.test(value.binary)))throw Error('INVALID_AGENT_SELECTION')
 for(const kind of ['codex','claude','workbuddy','doubao','grok']){
  const binary=value[kind+'Binary']
  if(binary!==undefined&&(typeof binary!=='string'||!isAbsolute(binary)||/[\0\r\n]/.test(binary)))throw Error('INVALID_AGENT_SELECTION')
 }
 return {version:1,kind:value.kind,...['claude','workbuddy','doubao','grok'].includes(value.kind)?{binary:value.binary}:{},...Object.fromEntries(['codex','claude','workbuddy','doubao','grok'].filter(kind=>value[kind+'Binary']).map(kind=>[kind+'Binary',value[kind+'Binary']]))}
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
