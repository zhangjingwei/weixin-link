import {open,readFile,rename,unlink,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'

const name='terminal-setup.json'
const models={subscription:null,deepseek:'deepseek-flash',qwen:'qwen3.7-max',kimi:'kimi-k3.1-pro'}
export const terminalSetupFingerprint=profile=>createHash('sha256').update(profile?JSON.stringify({kind:profile.kind,model:profile.model,workspaceId:profile.workspaceId??null,apiKey:profile.apiKey}):'subscription').digest('hex')

export async function readTerminalSetupStatus(stateDir){
 const path=join(stateDir,name)
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw Error('TERMINAL_SETUP_STATUS_INVALID')}
 catch(error){if(error.code==='ENOENT')return null;throw error}
 let value;try{value=JSON.parse(await readFile(path,'utf8'))}catch{throw Error('TERMINAL_SETUP_STATUS_INVALID')}
 if(value?.version!==1||value.verified!==true||!Object.hasOwn(models,value.provider)||value.model!==models[value.provider]||!/^[a-f0-9]{64}$/.test(value.fingerprint)||typeof value.verifiedAt!=='string'||value.language!==undefined&&!['zh','en'].includes(value.language))throw Error('TERMINAL_SETUP_STATUS_INVALID')
 return value
}

export async function writeTerminalSetupStatus(stateDir,{provider,model,fingerprint,language='zh'}){
 if(!Object.hasOwn(models,provider)||model!==models[provider]||!/^[a-f0-9]{64}$/.test(fingerprint)||!['zh','en'].includes(language))throw Error('TERMINAL_SETUP_STATUS_INVALID')
 const path=join(stateDir,name),tmp=path+'.'+randomUUID()+'.tmp',file=await open(tmp,'wx',0o600)
 try{await file.writeFile(JSON.stringify({version:1,provider,model,verified:true,fingerprint,language,verifiedAt:new Date().toISOString()})+'\n');await file.sync()}finally{await file.close()}
 await rename(tmp,path)
}

export async function clearTerminalSetupStatus(stateDir){try{await unlink(join(stateDir,name))}catch(error){if(error.code!=='ENOENT')throw error}}
