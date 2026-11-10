import {mkdir,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {accountPaths} from './account-store.mjs'

export function accountCodexHome(accountId=process.env.WECHAT_ACCOUNT??'default',home){
 return join(accountPaths(accountId,home).stateDir,'codex-home')
}

export async function ensureAccountCodexHome(accountId=process.env.WECHAT_ACCOUNT??'default',home){
 const path=accountCodexHome(accountId,home)
 try{const existing=await lstat(path);if(!existing.isDirectory()||existing.isSymbolicLink())throw Error('INVALID_CODEX_HOME')}
 catch(error){if(error.code!=='ENOENT')throw error}
 await mkdir(path,{recursive:true,mode:0o700})
 const info=await lstat(path)
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('INVALID_CODEX_HOME')
 return path
}
