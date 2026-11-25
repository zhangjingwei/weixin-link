import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {systemCodex} from './system-codex.mjs'
import {ensureAccountCodexHome} from '../infrastructure/accounts/codex-home.mjs'
export const MODEL_PROBE_TIMEOUT_MS=180000
const timedOut=error=>error.code==='ETIMEDOUT'||error.killed&&error.signal==='SIGTERM'&&(error.code===null||error.code===undefined)

export function runModelProbeCommand(binary,args,options){
 return new Promise((resolve,reject)=>{
  const child=execFile(binary,args,options,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}))
  child.stdin.on('error',()=>{})
  child.stdin.end()
 })
}

export async function probeTerminalModel({accountId='default',home,binary,signal,model,execute=runModelProbeCommand,timeoutMs=MODEL_PROBE_TIMEOUT_MS}={}){
 const nonce=randomUUID(),dir=await mkdtemp(join(tmpdir(),'weixin-link-model-probe-')),output=join(dir,'answer.txt')
 const args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only',...model?['--model',model]:[],'--output-last-message',output,'请只回复以下校验码，不要调用工具，也不要附加其他内容：'+nonce]
 const env={...process.env,CODEX_HOME:await ensureAccountCodexHome(accountId,home)}
 try{
  // Run outside the user's project so repository instructions and large context
  // cannot turn a nonce check into unrelated work. Keep the account's authentication.
  await execute(binary??await systemCodex(home),args,{cwd:dir,env,signal,timeout:timeoutMs,maxBuffer:1024*1024})
  if((await readFile(output,'utf8')).trim()!==nonce)throw Error('MODEL_PROBE_RESPONSE_MISMATCH')
  return {verified:true,provider:'subscription',model:model??null}
 }catch(error){
  if(error.message==='MODEL_PROBE_RESPONSE_MISMATCH')throw error
  if(timedOut(error)){
   // The final answer can be committed before CLI shutdown stalls. Only the
   // exact nonce in this invocation's private output file proves inference.
   const answer=await readFile(output,'utf8').catch(()=>null)
   if(answer?.trim()===nonce)return {verified:true,provider:'subscription',model:model??null}
   throw Error('MODEL_PROBE_TIMEOUT')
  }
  if(error.code==='ENOENT')throw Error('MODEL_PROBE_NO_RESPONSE')
  throw Error('MODEL_PROBE_FAILED')
 }finally{await rm(dir,{recursive:true,force:true})}
}
