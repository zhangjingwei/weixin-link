import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'
import {chmodSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID} from 'node:crypto'
import {ingressId, taskId} from '../../domain/messages/message-identity.mjs'
import {messageOwner, externalMessageId, requireExternalMessageId} from './ingress-envelope.mjs'
export class DurableJobs {
 constructor(path){
  this.db=new DatabaseSync(path)
  chmodSync(path,0o600)
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL,thread_id TEXT,turn_id TEXT,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ingress(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS receipt_notices(id TEXT PRIMARY KEY);
   CREATE INDEX IF NOT EXISTS job_owner ON jobs(owner,created);
   CREATE INDEX IF NOT EXISTS ingress_external_identity ON ingress(COALESCE(json_extract(payload,'$._conversationOwner'),json_extract(payload,'$.raw.from_user_id'),owner),CAST(COALESCE(json_extract(payload,'$.raw.message_id'),json_extract(payload,'$.raw.client_id')) AS TEXT),created);`)
  const hasColumn=(table,name)=>this.db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===name)
  if(!hasColumn('jobs','stop_request'))this.db.exec('ALTER TABLE jobs ADD COLUMN stop_request TEXT')
  if(!hasColumn('jobs','priority'))this.db.exec('ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0')
  if(!hasColumn('jobs','outcome'))this.db.exec('ALTER TABLE jobs ADD COLUMN outcome TEXT')
  if(!hasColumn('jobs','context'))this.db.exec('ALTER TABLE jobs ADD COLUMN context TEXT')
 }
 add(owner,input,key,ingressIds=[]){const id=key?taskId(owner,key):randomUUID(),text=JSON.stringify(input);if(Buffer.byteLength(text)>2*1024*1024)throw Error('INPUT_TOO_LARGE');this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO jobs(id,owner,input,state,thread_id,turn_id,created) VALUES(?,?,?,\'pending\',NULL,NULL,?)').run(id,owner,text,Date.now());this.acknowledge(ingressIds);this.db.exec('COMMIT');return id}catch(error){this.db.exec('ROLLBACK');throw error}}
 get(id){const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return r?{...r,input:JSON.parse(r.input),context:r.context?JSON.parse(r.context):null}:null}
 listForOwner(owner,{offset=0,limit=20}={}){if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)throw Error('MANAGEMENT_INVALID_ARGUMENTS');const rows=this.db.prepare('SELECT id,state,thread_id,turn_id,created FROM jobs WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT ? OFFSET ?').all(owner,limit+1,offset);return {items:rows.slice(0,limit).map(r=>({taskId:r.id,title:taskDisplayTitle(this.get(r.id).input,this.get(r.id).input?.projectDispatch?.title),state:r.state,threadId:r.thread_id,turnId:r.turn_id,createdAt:new Date(r.created).toISOString()})),nextOffset:rows.length>limit?offset+limit:null}}
 recheckTask(owner,id,threadId){return this.db.prepare("UPDATE jobs SET state=CASE WHEN turn_id IS NULL THEN 'bound' ELSE 'submitted' END WHERE owner=? AND id=? AND state='uncertain' AND thread_id=?").run(owner,id,threadId).changes}
 recheck(owner){return this.db.prepare("UPDATE jobs SET state=CASE WHEN turn_id IS NULL THEN 'bound' ELSE 'submitted' END WHERE owner=? AND state='uncertain' AND thread_id IS NOT NULL").run(owner).changes}
 claimReceipt(id){return id?this.db.prepare('INSERT OR IGNORE INTO receipt_notices VALUES(?)').run(id).changes===1:false}
 pendingMaterials(owner,exceptId){const raw=this.rawPending().filter(m=>m.userId===owner&&m._ingressId!==exceptId&&(m.images?.length||m.files?.length||m.videos?.length||m.voices?.length));const prepared=this.pending().filter(j=>j.owner===owner&&j.id!==exceptId&&typeof j.input==='object'&&(j.input.attachments?.length||j.input.images?.length||j.input.audios?.length));return raw.length+prepared.length}
 uncertainCount(owner){return this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner=? AND state='uncertain'").get(owner).count}
 pending(){return this.db.prepare("SELECT id FROM jobs WHERE state IN ('pending','starting','bound','submitted') ORDER BY priority DESC,created,rowid").all().map(r=>this.get(r.id))}
 context(id,context){this.db.prepare('UPDATE jobs SET context=? WHERE id=?').run(JSON.stringify(context),id)}
 bind(id,threadId){this.db.prepare("UPDATE jobs SET state='bound',thread_id=? WHERE id=? AND state IN ('pending','starting')").run(threadId,id)}
 submitted(id,turnId){this.db.prepare("UPDATE jobs SET state='submitted',turn_id=? WHERE id=? AND state='bound'").run(turnId,id)}
 waitForDesktop(owner,id,confirmation){
  return this.db.prepare("UPDATE jobs SET state='waiting_desktop',context=? WHERE owner=? AND id=? AND state='starting' AND thread_id IS NULL").run(JSON.stringify({desktopConfirmation:confirmation}),owner,id).changes===1
 }
 desktopChoices(owner,threadId){
  return this.db.prepare("SELECT json_extract(context,'$.desktopConfirmation.code') AS code FROM jobs WHERE owner=? AND state='waiting_desktop' AND json_extract(context,'$.desktopConfirmation.threadId')=? ORDER BY created,rowid LIMIT 5").all(owner,threadId).map(row=>row.code)
 }
 desktopJob(owner,code){
  const row=this.db.prepare("SELECT id FROM jobs WHERE owner=? AND state='waiting_desktop' AND json_extract(context,'$.desktopConfirmation.code')=?").get(owner,code)
  return row&&this.get(row.id)
 }
 retryAfterDesktop(owner,id,code){
  return this.db.prepare("UPDATE jobs SET state='pending' WHERE owner=? AND id=? AND state='waiting_desktop' AND json_extract(context,'$.desktopConfirmation.code')=?").run(owner,id,code).changes===1
 }
 claimNativeQueue(owner,id,threadId,context){
  return this.db.prepare("UPDATE jobs SET state='bound',thread_id=?,context=? WHERE owner=? AND id=? AND state='pending' AND thread_id IS NULL").run(threadId,JSON.stringify(context),owner,id).changes===1
 }
 claimStart(owner,id){return this.db.prepare("UPDATE jobs SET state='starting' WHERE owner=? AND id=? AND state='pending' AND thread_id IS NULL").run(owner,id).changes===1}
 changePending(owner,id,action){
  if(!['cancel','prioritize'].includes(action))throw Error('MANAGEMENT_INVALID_ARGUMENTS')
  const result=action==='cancel'?this.db.prepare("UPDATE jobs SET state='cancelled' WHERE owner=? AND id=? AND state='pending' AND thread_id IS NULL").run(owner,id):this.db.prepare("UPDATE jobs SET priority=(SELECT COALESCE(MAX(priority),0)+1 FROM jobs WHERE owner=?) WHERE owner=? AND id=? AND state='pending' AND thread_id IS NULL").run(owner,owner,id)
  return result.changes===1
 }
 cancelPendingBatch(owner,ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length)throw Error('MANAGEMENT_INVALID_ARGUMENTS')
  this.db.exec('BEGIN IMMEDIATE')
  try{for(const id of ids)if(!this.changePending(owner,id,'cancel'))throw Error('MANAGEMENT_STALE_TASK');this.db.exec('COMMIT');return ids.length}catch(error){this.db.exec('ROLLBACK');throw error}
 }
 markOutcome(id,outcome){this.db.prepare('UPDATE jobs SET outcome=? WHERE id=?').run(outcome,id)}
 mark(id,state){if(!['done','uncertain','cancelled'].includes(state))throw Error('INVALID_STATE');this.db.prepare("UPDATE jobs SET state=? WHERE id=? AND state NOT IN ('done','cancelled')").run(state,id)}
 findCaptured(message){const real=messageOwner(message),key=externalMessageId(message);if(key===undefined)return null
 const row=this.db.prepare('SELECT id,payload,state FROM ingress WHERE id=?').get(ingressId(real,key))??this.db.prepare("SELECT id,payload,state FROM ingress WHERE COALESCE(json_extract(payload,'$._conversationOwner'),json_extract(payload,'$.raw.from_user_id'),owner)=? AND CAST(COALESCE(json_extract(payload,'$.raw.message_id'),json_extract(payload,'$.raw.client_id')) AS TEXT)=? ORDER BY created LIMIT 1").get(real,String(key));return row?{...JSON.parse(row.payload),_ingressId:row.id,_captureState:row.state}:null}
 capture(message){const key=requireExternalMessageId(message),prior=this.findCaptured(message);if(prior)return prior._captureState==='pending'?prior._ingressId:null;const real=messageOwner(message),id=ingressId(real,key);const value=Object.fromEntries(['userId','text','images','files','videos','voices','raw','references','_setupAction','_contextToken','_conversationOwner','_conversationCommand','_conversationSelectionVersion','_sessionCommand','_promptReply','_traceId','_desktopChoices','_desktopQuit'].filter(k=>message[k]!==undefined).map(k=>[k,message[k]])),payload=JSON.stringify(value);if(Buffer.byteLength(payload)>2*1024*1024)throw Error('ENVELOPE_TOO_LARGE');this.db.prepare("INSERT OR IGNORE INTO ingress(id,owner,payload,state,created) VALUES(?,?,?,'pending',?)").run(id,message.userId,payload,Date.now());return this.db.prepare('SELECT state FROM ingress WHERE id=?').get(id)?.state==='pending'?id:null}
 // Freeze the queue boundary before the SDK advances its cursor. A replay
 // of the same stop must never cancel messages that arrived afterwards.
 captureStop(message){
  this.db.exec('BEGIN IMMEDIATE')
  try{
   const prior=this.findCaptured(message)
   const id=this.capture(message)
   if(!prior && id){
    const owner=message.userId
    this.db.prepare("UPDATE ingress SET state='cancelled' WHERE owner=? AND state='pending' AND id<>?").run(owner,id)
    this.db.prepare("UPDATE jobs SET state='cancelled' WHERE owner=? AND state IN ('pending','starting','waiting_desktop') AND thread_id IS NULL").run(owner)
    this.db.prepare("UPDATE jobs SET stop_request=? WHERE owner=? AND state IN ('bound','submitted')").run(id,owner)
   }
   this.db.exec('COMMIT')
   return {id,fresh:!prior}
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
 claimRecoveredStop(job){
  return this.db.prepare("UPDATE jobs SET stop_request=NULL WHERE id=? AND owner=? AND thread_id=? AND turn_id=? AND stop_request IS NOT NULL").run(job.id,job.owner,job.thread_id,job.turn_id).changes===1
 }
 claimLiveStop(owner,id,taskId){return this.db.prepare('UPDATE jobs SET stop_request=NULL WHERE owner=? AND stop_request=? AND id=?').run(owner,id,taskId).changes===1}
 rawCurrent(id){return this.db.prepare('SELECT state FROM ingress WHERE id=?').get(id)?.state==='pending'}
 hasPendingInput(owner){return !!this.db.prepare("SELECT 1 FROM ingress WHERE owner=? AND state='pending' LIMIT 1").get(owner)}
 rawPending(){return this.db.prepare("SELECT id,payload FROM ingress WHERE state='pending' ORDER BY created,rowid").all().map(r=>({...JSON.parse(r.payload),_ingressId:r.id,_recovered:true}))}
 acknowledge(ids){const stmt=this.db.prepare("UPDATE ingress SET state='done' WHERE id=? AND state='pending'");for(const id of ids??[])stmt.run(id)}
 cancel(owner){this.db.prepare("UPDATE jobs SET stop_request=COALESCE(stop_request,'cancel') WHERE owner=? AND state IN ('bound','submitted') AND json_extract(context,'$.nativeQueue')=1").run(owner);this.db.prepare("UPDATE ingress SET state='cancelled' WHERE owner=? AND state='pending'").run(owner);this.db.prepare("UPDATE jobs SET state='cancelled' WHERE owner=? AND state IN ('pending','starting','waiting_desktop') AND thread_id IS NULL").run(owner)}
 close(){this.db.close()}
}
