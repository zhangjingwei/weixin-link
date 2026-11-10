import {mkdir,open,readFile,rename,lstat,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {accountPaths,assertAccount} from './account-store.mjs'

const FILE='codex-provider.json'
const MODELS={deepseek:'deepseek-flash',qwen:'qwen3.7-max'}

function validate(profile){
 if(!profile||profile.version!==1||!Object.hasOwn(MODELS,profile.kind)||profile.model!==MODELS[profile.kind]||typeof profile.apiKey!=='string'||!/^\S{8,4096}$/.test(profile.apiKey))throw Error('INVALID_PROVIDER_PROFILE')
 if(profile.kind==='qwen'&&!/^[a-zA-Z0-9-]{3,80}$/.test(profile.workspaceId))throw Error('INVALID_QWEN_WORKSPACE_ID')
 return profile
}

export async function readProviderProfile(stateDir){
 try{
  const path=join(stateDir,FILE),file=await lstat(path)
  if(!file.isFile()||(process.platform!=='win32'&&(file.mode&0o077)))throw Error('UNSAFE_PROVIDER_PROFILE')
  let value;try{value=JSON.parse(await readFile(path,'utf8'))}catch{throw Error('INVALID_PROVIDER_PROFILE')}
  return validate(value)
 }catch(error){if(error.code==='ENOENT')return null;throw error}
}

export async function saveProviderProfile({kind,apiKey,workspaceId,accountId='default',home}){
 if(!Object.hasOwn(MODELS,kind))throw Error('INVALID_PROVIDER_KIND')
 const account=await assertAccount(accountId,home)
 const profile=validate({version:1,kind,model:MODELS[kind],apiKey,...kind==='qwen'?{workspaceId}:{}})
 await mkdir(account.stateDir,{recursive:true,mode:0o700})
 const path=join(account.stateDir,FILE),tmp=path+'.'+randomUUID()+'.tmp',file=await open(tmp,'wx',0o600)
 try{await file.writeFile(JSON.stringify(profile)+'\n');await file.sync()}finally{await file.close()}
 await rename(tmp,path)
 return {kind,model:profile.model,account:account.id,restartRequired:true}
}

export async function clearProviderProfile({accountId='default',home}={}){
 const account=await assertAccount(accountId,home)
 try{await unlink(join(account.stateDir,FILE))}catch(error){if(error.code!=='ENOENT')throw error}
 return {kind:'subscription',account:account.id,restartRequired:true}
}

export function providerEnvironment(profile,env=process.env){
 if(!profile)return {options:env,secrets:{}}
 validate(profile)
 const key=profile.kind==='deepseek'?'WECHAT_DEEPSEEK_API_KEY':'WECHAT_QWEN_API_KEY'
 const baseUrl=profile.kind==='deepseek'?'https://api.deepseek.com':`https://${profile.workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
 return {options:{...env,WECHAT_CODEX_PROVIDER:profile.kind,WECHAT_CODEX_MODEL:profile.model,WECHAT_CODEX_BASE_URL:baseUrl,WECHAT_CODEX_API_KEY_ENV:key,WECHAT_CODEX_WEB_SEARCH:'disabled'},secrets:{[key]:profile.apiKey}}
}

export async function accountProviderProfile(accountId='default',home){return readProviderProfile(accountPaths(accountId,home).stateDir)}
