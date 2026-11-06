import {readFile,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {RemoteStore} from '../core/registry-lock.mjs'
export class BindingPermit{
 constructor(dir){this.dir=dir;this.path=join(dir,'setup-bind-permit.json')}
 async read(){try{return JSON.parse(await readFile(this.path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
 async save(value){const tmp=this.path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,this.path)}
 locked(fn){return new RemoteStore(this.dir).locked('setup-binding-permit',fn)}
 issue(target,owner){return this.locked(async()=>{const old=await this.read();if(old?.phase==='committing')throw Error('BINDING_ALREADY_COMMITTING');const p={id:randomUUID(),target,owner,phase:'waiting'};await this.save(p);return p})}
 commit(id,target){return this.locked(async()=>{const p=await this.read();if(p?.id!==id||p.target!==target||p.phase!=='waiting')throw Error('BINDING_CANCELLED');p.phase='committing';await this.save(p)})}
 finish(id){return this.locked(async()=>{const p=await this.read();if(p?.id===id){p.phase='finished';await this.save(p)}})}
 cancel(owner){return this.locked(async()=>{const p=await this.read();if(!p||p.owner!==owner)return 'none';if(p.phase==='committing')return 'committing';p.phase='cancelled';await this.save(p);return 'cancelled'})}
}
