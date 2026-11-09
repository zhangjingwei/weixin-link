import {controlEndpoint} from '../infrastructure/runtime/control-endpoint.mjs'
import {homedir as platformHome} from 'node:os'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {join} from 'node:path'
import {mkdir,readFile,writeFile,readdir,lstat,rename} from 'node:fs/promises'
export function accountPaths(id=process.env.WECHAT_ACCOUNT??'default',home=(process.env.HOME||platformHome())){
 if(typeof id!=='string'||! /^[a-z][a-z0-9-]{0,31}$/.test(id))throw Error('INVALID_ACCOUNT_ID')
 const base=join(home,'.local/share/wechat-ping-bot'),stateDir=id==='default'?base:join(base,'accounts',id)
 return {id,base,stateDir,socket:controlEndpoint(stateDir),service:id==='default'?'wechat-ping-bot.service':`wechat-ping-bot@${id}.service`}
}
export async function createAccount(id,home){const p=accountPaths(id,home);if(id==='default')throw Error('DEFAULT_ACCOUNT_EXISTS');await mkdir(join(p.base,'accounts'),{recursive:true,mode:0o700});await mkdir(p.stateDir,{mode:0o700});await writeFile(join(p.stateDir,'account.json'),JSON.stringify({id,created_at:new Date().toISOString()})+'\n',{mode:0o600});return p}
export async function listAccounts(home=(process.env.HOME||platformHome())){const base=accountPaths('default',home).base;let names=[];try{names=await readdir(join(base,'accounts'))}catch(e){if(e.code!=='ENOENT')throw e}const result=[accountPaths('default',home)];for(const id of names){try{const p=accountPaths(id,home),info=await lstat(p.stateDir);if(info.isDirectory()&&!info.isSymbolicLink()){await readFile(join(p.stateDir,'account.json'));result.push(p)}}catch{}}return result}
export async function assertAccount(id,home){const p=accountPaths(id,home);if(id!=='default'){const info=await lstat(p.stateDir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('INVALID_ACCOUNT_DIRECTORY');const meta=JSON.parse(await readFile(join(p.stateDir,'account.json'),'utf8'));if(meta.id!==id)throw Error('ACCOUNT_ID_MISMATCH')}return p}
export async function loginHealth(p){const ids=new Set(),issues=[];let credentialStatus='missing'
 for(const [name,field] of [['credentials.json','accountId'],['account-identity.json','accountId']]){try{const value=JSON.parse(await readFile(join(p.stateDir,name),'utf8'));if(typeof value?.[field]!=='string'||!value[field])throw Error('INVALID_IDENTITY');ids.add(value[field]);if(name==='credentials.json')credentialStatus='readable'}catch(e){if(e.code==='ENOENT')continue;issues.push(name==='credentials.json'?'CREDENTIALS_UNREADABLE':'IDENTITY_UNREADABLE');if(name==='credentials.json')credentialStatus='unreadable'}}
 return {ids:[...ids],issues,credentialStatus}
}
export async function rememberIdentity(p,credentials){const path=join(p.stateDir,'account-identity.json');await writeFile(path+'.tmp',JSON.stringify({accountId:credentials.accountId})+'\n',{mode:0o600});await rename(path+'.tmp',path)}
export async function assertUniqueLogin(id,credentials,home){if(typeof credentials?.accountId!=='string'||!credentials.accountId)throw Error('INVALID_LOGIN');const issues=[];for(const p of await listAccounts(home)){if(p.id===id)continue;const health=await loginHealth(p);issues.push(...health.issues.map(code=>({account:p.id,code})));if(health.ids.includes(credentials.accountId))throw Error('WECHAT_ACCOUNT_ALREADY_REGISTERED')}return {issues}}


export async function registerLogin(id,credentials,home=(process.env.HOME||platformHome())){const p=await assertAccount(id,home);if(!credentials?.accountId||!credentials?.userId||!credentials?.token)throw Error('INVALID_LOGIN')
 return new RemoteStore(p.base).locked('account-login',async()=>{let existing;try{existing=JSON.parse(await readFile(join(p.stateDir,'credentials.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(existing?.accountId&&existing.accountId!==credentials.accountId)throw Error('PROFILE_BOUND_TO_DIFFERENT_ACCOUNT');await assertUniqueLogin(id,credentials,home);let owners
  try{owners=JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;owners=[credentials.userId]}
  if(!Array.isArray(owners)||!owners.length||owners.some(v=>typeof v!=='string'||!v))throw Error('INVALID_OWNERS')
  await rememberIdentity(p,credentials)
  for(const [name,value] of [['codex-owners.json',owners],['credentials.json',credentials]]){const path=join(p.stateDir,name);await writeFile(path+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});await rename(path+'.tmp',path)}
 })
}
