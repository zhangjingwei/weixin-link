import {setupMessage,setupError} from './cli-output.mjs'
import {fileURLToPath as repositoryFilePath} from 'node:url'
const repositoryDirectory=repositoryFilePath(new URL('../../',import.meta.url))
import {ServiceManager,confirmServiceStopped} from './platform-service.mjs'
import {installConfig} from './install-config.mjs'
import {pairingStatus,PairingState,exportQr} from '../infrastructure/wechat/pairing-state.mjs'
import {setTimeout as delay} from 'node:timers/promises'
import {createAccount,listAccounts,assertAccount,loginHealth} from '../infrastructure/accounts/account-store.mjs'
import {readFile,writeFile,copyFile,mkdir,chmod,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {controlRequest} from '../infrastructure/runtime/runtime-control.mjs'
import {readPairingCode} from './pairing-code-input.mjs'
import {waitForPairingVerification} from './pairing-verification.mjs'
const services=new ServiceManager()
const exec=promisify(execFile),action=process.argv[2],id=process.argv[3]
async function active(service){return (await services.status(service)).active}
async function submitCode(p,code){
 if(!/^\d{4,12}$/.test(code))throw Error('INVALID_VERIFICATION_CODE')
 const path=join(p.stateDir,'pairing-code.txt')
 await writeFile(path+'.tmp',code,{mode:0o600});await rename(path+'.tmp',path)
}
async function run(){
 if(action==='capabilities')return {auto_pin_wait:true}
 if(action==='create'){const p=await createAccount(id);return {account:p.id,status:'created'}}
 if(action==='list'){const rows=[];for(const p of await listAccounts()){let runtime;try{runtime=await controlRequest(p.socket,'GET','/status')}catch{}const pairing=await pairingStatus(p.stateDir,{running:await active('wechat-pair-'+p.id+'.service')}),health=await loginHealth(p);rows.push({account:p.id,service_active:await active(p.service),ready:runtime?.ready??false,pairing:pairing.status,qr_remaining_seconds:pairing.remaining_seconds??null,credential_status:health.credentialStatus,issues:health.issues,codex_backend:runtime?.backend??null})}return {accounts:rows}}
 let p
 try{p=await assertAccount(id)}catch(error){if(error.code==='ENOENT')throw Error('ACCOUNT_NOT_FOUND');throw error}
 if(action==='login'){if(await active(p.service))throw Error('STOP_ACCOUNT_BEFORE_RELOGIN');const unit='wechat-pair-'+p.id;if(await active(unit+'.service'))return {account:p.id,status:'already_pairing'};await services.pair(p.id);return {account:p.id,status:'pairing_started'}}
 if(action==='refresh-qr'||action==='refresh'){
  if(await active(p.service))throw Error('ACCOUNT_ONLINE_NO_REFRESH_NEEDED')
  await new PairingState(p.stateDir).set('qr_expired')
  const pairService='wechat-pair-'+p.id+'.service',previous=await services.status(pairService)
  await services.stop(pairService)
  if(previous.active&&!await confirmServiceStopped(()=>services.status(pairService),previous.pid))throw Error('PAIRING_STOP_UNCONFIRMED')
  await services.pair(p.id)
  for(let n=0;n<80;n++){const status=await pairingStatus(p.stateDir,{running:await active('wechat-pair-'+p.id+'.service')});if(status.status==='waiting_scan')return exportQr(p,join(installConfig().workspace,'outputs'));await delay(250)}
  throw Error('QR_NOT_READY_RETRY')
 }
 if(action==='qr')return exportQr(p,join(installConfig().workspace,'outputs'),{running:await active('wechat-pair-'+p.id+'.service')})
 if(action==='verify-wait'){
  const input=process.stdin,privateInput=!!input.isTTY&&typeof input.setRawMode==='function',wasRaw=!!input.isRaw
  const cancelled=new AbortController(),discard=chunk=>{if(Buffer.from(chunk).includes(3))cancelled.abort()}
  if(privateInput){input.setRawMode(true);input.on('data',discard);input.resume()}
  try{
   return {account:p.id,...await waitForPairingVerification({
    status:async()=>{const running=await active('wechat-pair-'+p.id+'.service');return {...await pairingStatus(p.stateDir,{running}),running}},
    readCode:async()=>{
     if(!privateInput)throw Error('PIN_TERMINAL_REQUIRED')
     input.off('data',discard)
     try{return await readPairingCode()}finally{input.on('data',discard);input.resume()}
    },
    submitCode:code=>submitCode(p,code),signal:cancelled.signal,
   })}
  }finally{if(privateInput){input.off('data',discard);input.setRawMode(wasRaw);input.pause()}}
 }
 if(action==='verify'){
  const running=await active('wechat-pair-'+p.id+'.service')
  const status=await pairingStatus(p.stateDir,{running})
  if(!running||!['verification_code_required','verification_code_rejected'].includes(status.status))throw Error('VERIFICATION_NOT_REQUESTED')
  const code=process.argv[4]??await readPairingCode()
  await submitCode(p,code)
  return {account:p.id,status:'verification_submitted'}
 }
 if(action==='stop'){await services.stop('wechat-pair-'+p.id+'.service').catch(()=>{});if(!await active(p.service)){await services.stop(p.service);return {account:p.id,status:'stopped'}}await exec(process.execPath,[join(repositoryDirectory,'src/tools/activate-diagnostics.mjs'),'--stop'],{env:{...process.env,WECHAT_ACCOUNT:p.id},timeout:650000});return {account:p.id,status:'stopped'}}
 if(action==='start'){if(!await readFile(join(p.stateDir,'codex-owners.json'),'utf8'))throw Error('LOGIN_FIRST');await services.start(p.service);return {account:p.id,status:'starting'}}
 throw Error('USAGE: create|login|qr|refresh-qr|verify|verify-wait|list|start|stop ACCOUNT')
}
const human=process.argv.includes('--human')
try{const result=await run();console.log(human?setupMessage(action,result):JSON.stringify({ok:true,...result}))}catch(e){if(human)console.error(setupError(e));else console.log(JSON.stringify({ok:false,error:/^[A-Z0-9_:| -]+$/.test(e.message)?e.message:e.code??'ACCOUNT_OPERATION_FAILED'}));process.exitCode=1}
