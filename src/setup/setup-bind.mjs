import {fileURLToPath as repositoryFilePath} from 'node:url'
const repositoryDirectory=repositoryFilePath(new URL('../../',import.meta.url))
import {BindingPermit} from './setup-binding-permit.mjs'
// Deferred maintenance worker: let the WeChat control reply finish before switching its service.
import {containerForAccount} from './setup-container.mjs'
import {controlRequest} from '../core/runtime/runtime-control.mjs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
const exec=promisify(execFile),{id,account}=await containerForAccount(process.argv[2]);const target=process.argv[3],permitId=process.argv[4],permit=new BindingPermit(account.stateDir);if(id!==target)throw Error('CONTAINER_TARGET_CHANGED');let receipt={status:'waiting_idle',backend:id};const save=()=>writeFile(join(account.stateDir,'setup-bind-result.json'),JSON.stringify(receipt)+'\n',{mode:0o600});await save()
try{let idle=false;for(let n=0;n<600;n++){const p=await permit.read();if(p?.id!==permitId||p.phase!=='waiting')throw Error('BINDING_CANCELLED');const s=await controlRequest(account.socket,'GET','/status');if(s.ready&&s.idle){idle=true;break}await delay(1000)}if(!idle)throw Error('ACCOUNT_REMAINED_BUSY');await permit.commit(permitId,target);const {stdout}=await exec(process.execPath,[join(repositoryDirectory,'src/setup/backend-manager.mjs'),'bind',account.id,id],{timeout:650000,maxBuffer:65536});const result=JSON.parse(stdout.trim());if(!result.ok)throw Error('BINDING_NOT_VERIFIED');receipt={status:result.status,backend:id};await save()}catch{receipt.status='binding_failed_or_unconfirmed';await save();process.exitCode=1}finally{await permit.finish(permitId)}
