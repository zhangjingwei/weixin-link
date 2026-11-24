import {controlEndpoint} from '../runtime/control-endpoint.mjs'
import {homedir as platformHome} from 'node:os'
import {RemoteStore} from '../storage/registry-lock.mjs'
import {join} from 'node:path'
import {readFile,writeFile,readdir,lstat,rename} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
export function accountPaths(id=process.env.WECHAT_ACCOUNT??'default',home){
 if(id!=='default')throw Error('SINGLE_USER_INSTALLATION')
 return legacyAccountPaths(id,home)
}

// Used only to recognize and stop services left by earlier multi-account installations.
export function legacyAccountPaths(id=process.env.WECHAT_ACCOUNT??'default',home=(process.env.HOME||platformHome())){
 if(typeof id!=='string'||! /^[a-z][a-z0-9-]{0,31}$/.test(id))throw Error('INVALID_ACCOUNT_ID')
 const base=join(home,'.local/share/wechat-ping-bot'),stateDir=id==='default'?base:join(base,'accounts',id)
 return {id,base,stateDir,socket:controlEndpoint(stateDir),service:id==='default'?'wechat-ping-bot.service':`wechat-ping-bot@${id}.service`}
}
export async function listAccounts(home=(process.env.HOME||platformHome())){const base=accountPaths('default',home).base;let names=[];try{names=await readdir(join(base,'accounts'))}catch(e){if(e.code!=='ENOENT')throw e}const result=[accountPaths('default',home)];for(const id of names){try{const p=legacyAccountPaths(id,home),info=await lstat(p.stateDir);if(info.isDirectory()&&!info.isSymbolicLink()){await readFile(join(p.stateDir,'account.json'));result.push(p)}}catch{}}return result}
export async function assertAccount(id,home){return accountPaths(id,home)}
export async function loginHealth(p){const ids=new Set(),issues=[];let credentialStatus='missing'
 for(const [name,field] of [['credentials.json','accountId'],['account-identity.json','accountId']]){try{const value=JSON.parse(await readFile(join(p.stateDir,name),'utf8'));if(typeof value?.[field]!=='string'||!value[field])throw Error('INVALID_IDENTITY');ids.add(value[field]);if(name==='credentials.json')credentialStatus='readable'}catch(e){if(e.code==='ENOENT')continue;issues.push(name==='credentials.json'?'CREDENTIALS_UNREADABLE':'IDENTITY_UNREADABLE');if(name==='credentials.json')credentialStatus='unreadable'}}
 return {ids:[...ids],issues,credentialStatus}
}
export async function bindingIdentity(account){
 const values=[]
 for(const name of ['credentials.json','account-identity.json']){try{const data=JSON.parse(await readFile(join(account.stateDir,name),'utf8'));if(typeof data.accountId!=='string'||!data.accountId)throw Error('INVALID_WECHAT_BINDING_IDENTITY');values.push(data.accountId)}catch(e){if(e.code!=='ENOENT')throw e}}
 if(!values.length)throw Error('WECHAT_BINDING_IDENTITY_MISSING')
 if(new Set(values).size!==1)throw Error('WECHAT_BINDING_IDENTITY_MISMATCH')
 return values[0]
}
export async function rememberIdentity(p,credentials){const path=join(p.stateDir,'account-identity.json');await writeFile(path+'.tmp',JSON.stringify({accountId:credentials.accountId})+'\n',{mode:0o600});await rename(path+'.tmp',path)}
export async function registerLogin(id,credentials,home=(process.env.HOME||platformHome())){const p=await assertAccount(id,home);if(!credentials?.accountId||!credentials?.userId||!credentials?.token)throw Error('INVALID_LOGIN')
 return new RemoteStore(p.base).locked('account-login',async()=>{let existing;try{existing=JSON.parse(await readFile(join(p.stateDir,'credentials.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}let bound;try{bound=await bindingIdentity(p)}catch(e){if(e.message!=='WECHAT_BINDING_IDENTITY_MISSING')throw e}
  const botChanged=!!bound&&bound!==credentials.accountId
  if(botChanged&&(!existing||existing.accountId!==bound||existing.userId!==credentials.userId))throw Error('PROFILE_BOUND_TO_DIFFERENT_ACCOUNT')
  if(existing?.accountId&&existing.accountId!==credentials.accountId&&!botChanged)throw Error('PROFILE_BOUND_TO_DIFFERENT_ACCOUNT')
  let owners
  try{owners=JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;owners=[credentials.userId]}
  if(!Array.isArray(owners)||owners.length!==1||owners[0]!==credentials.userId||owners.some(v=>typeof v!=='string'||!v))throw Error('INVALID_OWNERS')
  if(botChanged){
   const generation=randomUUID()
   for(const name of ['cursor.json','context_tokens.json','typing_tickets.json']){
    const path=join(p.stateDir,name)
    try{await rename(path,path+'.previous-'+generation)}catch(e){if(e.code!=='ENOENT')throw e}
   }
  }
  await rememberIdentity(p,credentials)
  for(const [name,value] of [['codex-owners.json',owners],['credentials.json',credentials]]){const path=join(p.stateDir,name);await writeFile(path+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});await rename(path+'.tmp',path)}
 })
}
