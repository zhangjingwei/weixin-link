import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {findCodex,installConfig} from './install-config.mjs'
import {ensureAccountCodexHome} from '../infrastructure/accounts/codex-home.mjs'
import {accountProviderProfile,providerEnvironment} from './provider-profile.mjs'
import {codexProviderOptions} from '../base/codex/provider-options.mjs'

export function runModelProbeCommand(binary,args,options){
 return new Promise((resolve,reject)=>{
  const child=execFile(binary,args,options,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}))
  child.stdin.on('error',()=>{})
  child.stdin.end()
 })
}

export async function probeTerminalModel({accountId='default',home,root,execute=runModelProbeCommand,timeoutMs=60000}={}){
 const profile=await accountProviderProfile(accountId,home),provider=providerEnvironment(profile)
 const selected=codexProviderOptions({...provider.options,...provider.secrets})
 const configs=[];for(let i=1;i<selected.args.length;i++)if(selected.args[i]==='-c')configs.push('-c',selected.args[++i])
 const nonce=randomUUID(),dir=await mkdtemp(join(tmpdir(),'weixin-link-model-probe-')),output=join(dir,'answer.txt')
 const args=['exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','--sandbox','read-only',...configs,'--output-last-message',output,'请只回复以下校验码，不要调用工具，也不要附加其他内容：'+nonce]
 const env={...process.env,...provider.secrets,CODEX_HOME:await ensureAccountCodexHome(accountId,home)}
 for(const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','CODEX_API_KEY'])if(key!==selected.credentialEnvKey)delete env[key]
 try{
  await execute(findCodex(home,{root}),args,{cwd:installConfig(home,{root}).workspace,env,timeout:timeoutMs,maxBuffer:1024*1024})
  if((await readFile(output,'utf8')).trim()!==nonce)throw Error('MODEL_PROBE_RESPONSE_MISMATCH')
  return {verified:true,provider:profile?.kind??'subscription',model:profile?.model??null}
 }catch(error){
  if(error.message==='MODEL_PROBE_RESPONSE_MISMATCH')throw error
  if(error.killed||error.code==='ETIMEDOUT')throw Error('MODEL_PROBE_TIMEOUT')
  if(error.code==='ENOENT')throw Error('MODEL_PROBE_NO_RESPONSE')
  throw Error('MODEL_PROBE_FAILED')
 }finally{await rm(dir,{recursive:true,force:true})}
}
