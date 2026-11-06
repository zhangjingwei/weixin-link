import {fileURLToPath as repositoryFilePath} from 'node:url'
const repositoryDirectory=repositoryFilePath(new URL('../../',import.meta.url))
import {installConfig} from './install-config.mjs'
import {bindingIdentity,resolveBindingAccount} from '../base/codex/backend-identity.mjs'
import {accountPaths,assertAccount,listAccounts} from '../wechat/accounts.mjs'
import {loadBackend} from '../base/codex/codex-backend.mjs'
import {controlRequest} from '../core/runtime-control.mjs'
import {RemoteStore} from '../core/registry-lock.mjs'
import {readFile,writeFile,rename,unlink,access} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {DatabaseSync} from 'node:sqlite'
const exec=promisify(execFile),[action,id,target]=process.argv.slice(2),hostCwd=installConfig().workspace
async function serviceActive(p){try{return (await exec('systemctl',['--user','is-active',p.service])).stdout.trim()==='active'}catch{return false}}
async function ensureQueueEmpty(dir){const path=join(dir,'inbox.sqlite');try{await access(path)}catch(e){if(e.code==='ENOENT')return;throw e}const db=new DatabaseSync(path,{readOnly:true});try{const count=db.prepare("SELECT count(*) AS n FROM jobs WHERE state NOT IN ('done','cancelled')").get().n;const raw=db.prepare("SELECT count(*) AS n FROM ingress WHERE state='pending'").get().n;if(count||raw)throw Error('BACKEND_QUEUE_OR_UNCERTAINTY_REQUIRES_RECONCILIATION')}finally{db.close()}}
async function run(){
 if(action==='list'){const out=[];for(const p of await listAccounts()){const b=await loadBackend(p,hostCwd);out.push({accountId:await bindingIdentity(p),backend:b.id,kind:b.kind,container:b.container??null,service_active:await serviceActive(p)})}return {accounts:out}}
 const p=await resolveBindingAccount(id)
 if(action==='inspect'){const b=await loadBackend(p,hostCwd,target?{version:1,id:target}:undefined);if(b.kind==='podman')await b.preflight(JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8')));return {accountId:await bindingIdentity(p),backend:b.id,kind:b.kind,container:b.container??null,preflight:'passed'}}
 if(action!=='bind'||!target)throw Error('USAGE_LIST_OR_INSPECT_ACCOUNT_TARGET_OR_BIND_ACCOUNT_TARGET')
 return new RemoteStore(p.base).locked('codex-backend-binding',async()=>{
  const next=await loadBackend(p,hostCwd,{version:1,id:target}),previous=await loadBackend(p,hostCwd)
  for(const other of await listAccounts()){if(other.id===p.id)continue;const binding=await loadBackend(other,hostCwd);if(next.kind==='podman'&&binding.id===next.id)throw Error('CONTAINER_ALREADY_BOUND_TO_OTHER_ACCOUNT')}
  if(next.kind==='podman')await next.preflight(JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8')))
  if(previous.id===next.id)return {accountId:await bindingIdentity(p),backend:next.id,status:'already_bound'}
  await ensureQueueEmpty(previous.stateDir);await ensureQueueEmpty(next.stateDir)
  const active=await serviceActive(p)
  if(active){const status=await controlRequest(p.socket,'GET','/status');if(!status.ready||!status.idle)throw Error('ACCOUNT_BUSY_BINDING_NOT_CHANGED');await exec('node',[join(repositoryDirectory,'activate-diagnostics.mjs'),'--stop'],{env:{...process.env,WECHAT_ACCOUNT:p.id},timeout:650000})}
  if(active){try{await ensureQueueEmpty(previous.stateDir);await ensureQueueEmpty(next.stateDir)}catch(error){await exec('systemctl',['--user','start',p.service]);throw error}}
  const file=join(p.stateDir,'codex-backend.json');let old;try{old=await readFile(file)}catch(e){if(e.code!=='ENOENT')throw e}
  try{await writeFile(file+'.tmp',JSON.stringify({version:1,id:next.id,wechatAccountId:await bindingIdentity(p),updatedAt:new Date().toISOString()})+'\n',{mode:0o600});await rename(file+'.tmp',file)
   if(active){await exec('systemctl',['--user','start',p.service]);let ready=false;for(let n=0;n<40;n++){try{const status=await controlRequest(p.socket,'GET','/status');if(status.ready&&status.features?.codex_backend_binding&&status.features?.container_backend===(next.kind==='podman')&&status.backend?.id===next.id){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}if(!ready)throw Error('BOUND_ACCOUNT_STARTUP_NOT_VERIFIED')}
   return {accountId:await bindingIdentity(p),backend:next.id,status:active?'bound_and_runtime_verified':'configured_offline',oldHistoryPreserved:true,newStateNamespace:next.id!=='host'}
  }catch(error){if(active)await exec('systemctl',['--user','stop',p.service]).catch(()=>{});if(old)await writeFile(file,old,{mode:0o600});else await unlink(file).catch(()=>{});if(active)await exec('systemctl',['--user','start',p.service]).catch(()=>{});throw error}
 })
}
try{console.log(JSON.stringify({ok:true,...await run()}))}catch(error){console.log(JSON.stringify({ok:false,error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'BACKEND_OPERATION_FAILED'}));process.exitCode=1}
