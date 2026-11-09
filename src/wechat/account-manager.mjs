import {setupMessage,setupError} from '../setup/cli-output.mjs'
import {fileURLToPath as repositoryFilePath} from 'node:url'
const repositoryDirectory=repositoryFilePath(new URL('../../',import.meta.url))
import {ServiceManager} from '../setup/platform-service.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {pairingStatus,PairingState,exportQr} from './pairing-state.mjs'
import {setTimeout as delay} from 'node:timers/promises'
import {createAccount,listAccounts,assertAccount,loginHealth} from './accounts.mjs'
import {readFile,writeFile,copyFile,mkdir,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {controlRequest} from '../infrastructure/runtime/runtime-control.mjs'
const services=new ServiceManager()
const exec=promisify(execFile),action=process.argv[2],id=process.argv[3]
async function active(service){return (await services.status(service)).active}
async function run(){
 if(action==='create'){const p=await createAccount(id);return {account:p.id,status:'created'}}
 if(action==='list'){const rows=[];for(const p of await listAccounts()){let runtime;try{runtime=await controlRequest(p.socket,'GET','/status')}catch{}const pairing=await pairingStatus(p.stateDir,{running:await active('wechat-pair-'+p.id+'.service')}),health=await loginHealth(p);rows.push({account:p.id,service_active:await active(p.service),ready:runtime?.ready??false,pairing:pairing.status,qr_remaining_seconds:pairing.remaining_seconds??null,credential_status:health.credentialStatus,issues:health.issues,codex_backend:runtime?.backend??null})}return {accounts:rows}}
 const p=await assertAccount(id)
 if(action==='login'){if(await active(p.service))throw Error('STOP_ACCOUNT_BEFORE_RELOGIN');const unit='wechat-pair-'+p.id;if(await active(unit+'.service'))return {account:p.id,status:'already_pairing'};await services.pair(p.id);return {account:p.id,status:'pairing_started'}}
 if(action==='refresh-qr'||action==='refresh'){
  if(await active(p.service))throw Error('ACCOUNT_ONLINE_NO_REFRESH_NEEDED')
  await new PairingState(p.stateDir).set('qr_expired')
  await services.stop('wechat-pair-'+p.id+'.service').catch(()=>{})
  await services.pair(p.id)
  for(let n=0;n<80;n++){const status=await pairingStatus(p.stateDir,{running:await active('wechat-pair-'+p.id+'.service')});if(status.status==='waiting_scan')return exportQr(p,join(installConfig().workspace,'outputs'));await delay(250)}
  throw Error('QR_NOT_READY_RETRY')
 }
 if(action==='qr')return exportQr(p,join(installConfig().workspace,'outputs'),{running:await active('wechat-pair-'+p.id+'.service')})
 if(action==='verify'){const code=process.argv[4];if(!/^\d{4,12}$/.test(code??''))throw Error('INVALID_VERIFICATION_CODE');await writeFile(join(p.stateDir,'pairing-code.txt'),code,{mode:0o600});return {account:p.id,status:'verification_submitted'}}
 if(action==='stop'){await services.stop('wechat-pair-'+p.id+'.service').catch(()=>{});if(!await active(p.service)){await services.stop(p.service);return {account:p.id,status:'stopped'}}await exec(process.execPath,[join(repositoryDirectory,'src/tools/activate-diagnostics.mjs'),'--stop'],{env:{...process.env,WECHAT_ACCOUNT:p.id},timeout:650000});return {account:p.id,status:'stopped'}}
 if(action==='start'){if(!await readFile(join(p.stateDir,'codex-owners.json'),'utf8'))throw Error('LOGIN_FIRST');await services.start(p.service);return {account:p.id,status:'starting'}}
 throw Error('USAGE: create|login|qr|refresh-qr|verify|list|start|stop ACCOUNT')
}
const human=process.argv.includes('--human')
try{const result=await run();console.log(human?setupMessage(action,result):JSON.stringify({ok:true,...result}))}catch(e){if(human)console.error(setupError(e));else console.log(JSON.stringify({ok:false,error:/^[A-Z0-9_:| -]+$/.test(e.message)?e.message:e.code??'ACCOUNT_OPERATION_FAILED'}));process.exitCode=1}
