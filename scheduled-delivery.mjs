import {deliveryError} from './delivery-error.mjs'
import {DatabaseSync} from 'node:sqlite'
import {chmodSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
export const chinaDate=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
export async function readJobs(path){try{const c=JSON.parse(await readFile(path,'utf8'));if(!Array.isArray(c.jobs))throw Error('INVALID_JOBS');return c.jobs}catch(e){if(e.code==='ENOENT')return [];throw e}}
/** Only delivery claims; the existing OutputTransport remains the sole sender/queue. */
export class ScheduledDelivery{
 constructor({dbPath,configPath,owners,send,prepare=async(_user,text)=>text,now=()=>new Date()}){Object.assign(this,{configPath,owners:new Set(owners),send,prepare,now});this.db=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS scheduled_delivery(job TEXT,occurrence TEXT,state TEXT,updated INTEGER,PRIMARY KEY(job,occurrence));");const columns=this.db.prepare('PRAGMA table_info(scheduled_delivery)').all().map(c=>c.name);for(const col of ['packet','error'])if(!columns.includes(col))this.db.exec('ALTER TABLE scheduled_delivery ADD COLUMN '+col+' TEXT');this.db.prepare("UPDATE scheduled_delivery SET state='unknown' WHERE state='sending'").run()}
 async jobs(){return (await readJobs(this.configPath)).filter(j=>j.enabled&&(!j.startDate||chinaDate(this.now())>=j.startDate)&&this.owners.has(j.recipient))}
 async status(){const occurrence=chinaDate(this.now());return {occurrence,jobs:(await this.jobs()).map(j=>{const row=this.db.prepare('SELECT state,packet,error FROM scheduled_delivery WHERE job=? AND occurrence=?').get(j.id,occurrence);const packet=row?.packet?JSON.parse(row.packet):null;return {id:j.id,state:row?.state??'pending',...(packet?.kind==='bundle'?{progress:{text:packet.textParts,attachments:packet.attachments.map(a=>({fileName:a.fileName,status:a.status})),textErrors:packet.textErrors??{}}}:{}),...(row?.error?{error:JSON.parse(row.error)}:{})}})}}

 async deliver({jobId,occurrence,text,resume=false}){
  if(resume)return this.resume({jobId,occurrence})
  if(typeof jobId!=='string'||occurrence!==chinaDate(this.now())||typeof text!=='string'||!text.trim()||text.length>6000)throw Error('INVALID_SCHEDULED_MESSAGE')
  const job=(await this.jobs()).find(j=>j.id===jobId);if(!job)throw Error('SCHEDULE_NOT_AUTHORIZED')
  const claim=this.db.prepare("INSERT OR IGNORE INTO scheduled_delivery(job,occurrence,state,updated) VALUES(?,?,'sending',?)").run(jobId,occurrence,Date.now())
  if(!claim.changes)return {duplicate:true,state:this.db.prepare('SELECT state FROM scheduled_delivery WHERE job=? AND occurrence=?').get(jobId,occurrence).state}
  let packet;try{packet=await this.prepare(job.recipient,text)}catch(error){this.save(jobId,occurrence,'failed',null,deliveryError(error));return {state:'failed',accepted:false}}
  return this.dispatch(job,occurrence,packet)
 }
 save(job,occurrence,state,packet,error=null){this.db.prepare('UPDATE scheduled_delivery SET state=?,packet=?,error=?,updated=? WHERE job=? AND occurrence=?').run(state,packet?JSON.stringify(packet):null,error?JSON.stringify(error):null,Date.now(),job,occurrence)}
 async dispatch(job,occurrence,packet){const checkpoint=async()=>this.save(job.id,occurrence,'sending',packet);await checkpoint();let state='unknown',error=null;try{const result=await this.send(job.recipient,packet,{checkpoint,continueTextFailure:true});state=['accepted','cancelled','partial'].includes(result?.status)?result.status:'unknown'}catch(e){error=deliveryError(e)}this.save(job.id,occurrence,state,packet,error);return {state,accepted:state==='accepted'}}
 async resume({jobId,occurrence}){
  if(occurrence!==chinaDate(this.now()))throw Error('INVALID_SCHEDULED_MESSAGE');const job=(await this.jobs()).find(j=>j.id===jobId);if(!job)throw Error('SCHEDULE_NOT_AUTHORIZED');const row=this.db.prepare('SELECT state,packet FROM scheduled_delivery WHERE job=? AND occurrence=?').get(jobId,occurrence);if(!row||!['unknown','partial'].includes(row.state))throw Error('SCHEDULE_NOT_RESUMABLE');const packet=JSON.parse(row.packet??'null');if(!packet||packet.kind!=='bundle')throw Error('SCHEDULE_PROGRESS_UNAVAILABLE');
  const claim=this.db.prepare("UPDATE scheduled_delivery SET state='sending' WHERE job=? AND occurrence=? AND state=?").run(jobId,occurrence,row.state);if(!claim.changes)throw Error('SCHEDULE_BUSY');
  packet.textParts=packet.textParts.map(s=>s==='sending'?'unknown':s);for(const a of packet.attachments)if(a.status==='sending')a.status='unknown';
  // Explicit recovery only sends untouched parts. Unknown and accepted attempts are never replayed.
  return this.dispatch(job,occurrence,packet)
 }

 close(){this.db.close()}
}
