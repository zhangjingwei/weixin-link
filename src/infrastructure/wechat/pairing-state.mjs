import {readFile,writeFile,rename,copyFile,chmod,mkdir,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
const digest=value=>createHash('sha256').update(value).digest('hex')
export function browserLoginUrl(value){
 if(typeof value!=='string'||value.length>4096||/[\x00-\x20\x7f]/.test(value))return null
 try{const url=new URL(value);return url.protocol==='https:'&&url.username===''&&url.password===''&&url.hostname?value:null}catch{return null}
}
export async function readBrowserLoginUrl(dir,version){
 if(!/^[a-f0-9-]{36}$/.test(version))return null
 const path=join(dir,'login-'+version+'.url')
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)return null;return browserLoginUrl(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
}
export const QR_FRESHNESS_MS=90000 // Conservative local delivery window; not a claimed server TTL.
export class PairingState {
 constructor(dir,{now=Date.now}={}){this.dir=dir;this.now=now;this.tail=Promise.resolve()}
 enqueue(work){const run=this.tail.catch(()=>{}).then(work);this.tail=run;return run}
 async write(data){const path=join(this.dir,'pairing.json');await writeFile(path+'.tmp',JSON.stringify(data)+'\n',{mode:0o600});await rename(path+'.tmp',path)}
 set(status){return this.enqueue(()=>this.write({status,updated_at:new Date(this.now()).toISOString()}))}
 publish(bytes,{loginUrl}={}){return this.enqueue(async()=>{const version=randomUUID(),path=join(this.dir,'login-'+version+'.png');await writeFile(path,bytes,{mode:0o600});const url=browserLoginUrl(loginUrl);if(url)await writeFile(join(this.dir,'login-'+version+'.url'),url,{mode:0o600});await this.write({status:'waiting_scan',qr_version:version,qr_hash:digest(bytes),created_at:this.now(),valid_until:this.now()+QR_FRESHNESS_MS,updated_at:new Date(this.now()).toISOString()})})}
}
export async function pairingStatus(dir,{running=true,now=Date.now()}={}){let data;try{data=JSON.parse(await readFile(join(dir,'pairing.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return {status:'not_started'};return {status:'state_unreadable'}}
 if(['waiting_scan','requesting_qr','waiting_confirmation','qr_expired'].includes(data.status)&&!running)return {...data,status:'pairing_stopped'}
 if(data.status==='waiting_scan'&&(!data.qr_version||!Number.isFinite(data.valid_until)))return {...data,status:'refresh_required'}
 if(data.status==='waiting_scan'&&now>=data.valid_until)return {...data,status:'qr_refresh_required',remaining_seconds:0}
 return {...data,...(data.status==='waiting_scan'?{remaining_seconds:Math.max(0,Math.floor((data.valid_until-now)/1000))}:{})}
}
export async function exportQr(p,outDir,{running=true,now=Date.now()}={}){
 const state=await pairingStatus(p.stateDir,{running,now});if(state.status!=='waiting_scan')throw Error(state.status==='qr_refresh_required'?'QR_TOO_OLD_REFRESH_REQUIRED':'QR_REFRESH_REQUIRED')
 if(!/^[a-f0-9-]{36}$/.test(state.qr_version))throw Error('INVALID_QR_STATE')
 const bytes=await readFile(join(p.stateDir,'login-'+state.qr_version+'.png'));if(digest(bytes)!==state.qr_hash)throw Error('QR_STATE_MISMATCH')
 const check=await pairingStatus(p.stateDir,{running,now:Date.now()});if(check.status!=='waiting_scan'||check.qr_version!==state.qr_version)throw Error('QR_CHANGED_RETRY')
 await mkdir(outDir,{recursive:true,mode:0o700});const path=join(outDir,'wechat-login-'+p.id+'-'+state.qr_version+'.png');await writeFile(path,bytes,{mode:0o600});return {account:p.id,path,status:'scan_to_login',freshness_seconds:check.remaining_seconds,validity:'local_delivery_window; server may expire earlier'}
}
