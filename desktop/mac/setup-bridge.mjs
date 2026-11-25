// Runs against the selected installed source. stdout is a private pipe to the app.
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile), [root,action]=process.argv.slice(2),load=p=>import(pathToFileURL(join(root,'src',p))),emit=value=>console.log(JSON.stringify(value))
try {
 const account=async cmd=>JSON.parse((await exec(process.execPath,[join(root,'src/setup/account-manager.mjs'),cmd,'default'],{timeout:35000,maxBuffer:65536})).stdout)
 const row=(await account('list')).accounts[0]
 const {accountPaths}=await load('infrastructure/accounts/account-store.mjs'),paths=accountPaths()
 if(action==='status'){
  const phase=row.ready?'ready':row.service_active?'starting':row.issues?.length||['PROFILE_BOUND_TO_DIFFERENT_ACCOUNT','WECHAT_ACCOUNT_ALREADY_REGISTERED','CREDENTIALS_UNREADABLE'].includes(row.pairing)?'conflict':row.credential_status==='readable'?'stopped':row.pairing
  const qr=phase==='waiting_scan'?await (await load('infrastructure/wechat/pairing-state.mjs')).currentLoginLink(paths).catch(()=>null):null
  emit({phase,url:qr?.url,seconds:qr?.freshness_seconds})
 }else if(action==='qr'&&!row.ready&&!row.service_active&&!row.issues?.length&&row.credential_status==='missing'){await account('refresh-qr')}
 else if(action==='cancelPair'&&!row.service_active&&['waiting_scan','waiting_confirmation','verification_code_required','verification_code_rejected','requesting_qr'].includes(row.pairing)){const {ServiceManager}=await load('setup/platform-service.mjs');await new ServiceManager().stop('wechat-pair-default.service')}
 else if(action==='start'&&!row.ready&&!row.service_active&&row.credential_status==='readable'&&!row.issues?.length){await account('start')}
 else if(action==='pin'&&['verification_code_required','verification_code_rejected'].includes(row.pairing)){
  const child=execFile(process.execPath,[join(root,'src/setup/account-manager.mjs'),'verify','default'],{timeout:12000},e=>{if(e)process.exitCode=1});process.stdin.pipe(child.stdin)
 }else throw Error()
}catch{process.exitCode=1}
