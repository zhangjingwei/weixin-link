import {chmodSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID} from 'node:crypto'
import {ingressId, taskId} from '../../domain/messages/message-identity.mjs'
import {messageOwner, externalMessageId, requireExternalMessageId} from './ingress-envelope.mjs'
export class DurableJobs {
 constructor(path,{backendKey='codex:host'}={}){
  if(!/^(?:codex|claude):[a-z0-9-]{1,80}$/.test(backendKey))throw Error('INVALID_INBOX_BACKEND')
  this.backendKey=backendKey
  this.db=new DatabaseSync(path)
  chmodSync(path,0o600)
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL,thread_id TEXT,turn_id TEXT,created INTEGER NOT NULL,backend TEXT NOT NULL DEFAULT 'codex:host');
   CREATE TABLE IF NOT EXISTS ingress(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,backend TEXT NOT NULL DEFAULT 'codex:host');
   CREATE TABLE IF NOT EXISTS receipt_notices(id TEXT PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS inbox_migrations(source TEXT PRIMARY KEY,signature TEXT NOT NULL,completed INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS job_owner ON jobs(owner,created);
   CREATE INDEX IF NOT EXISTS ingress_external_identity ON ingress(COALESCE(json_extract(payload,'$._conversationOwner'),json_extract(payload,'$.raw.from_user_id'),owner),CAST(COALESCE(json_extract(payload,'$.raw.message_id'),json_extract(payload,'$.raw.client_id')) AS TEXT),created);`)
  const hasColumn=(table,name)=>this.db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===name)
  if(!hasColumn('jobs','context'))this.db.exec('ALTER TABLE jobs ADD COLUMN context TEXT')
  if(!hasColumn('jobs','backend'))this.db.exec("ALTER TABLE jobs ADD COLUMN backend TEXT NOT NULL DEFAULT 'codex:host'")
  if(!hasColumn('ingress','backend'))this.db.exec("ALTER TABLE ingress ADD COLUMN backend TEXT NOT NULL DEFAULT 'codex:host'")
 }
 add(owner,input,key,ingressIds=[]){const id=key?taskId(owner,key):randomUUID(),text=JSON.stringify(input);if(Buffer.byteLength(text)>2*1024*1024)throw Error('INPUT_TOO_LARGE');this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO jobs(id,owner,input,state,thread_id,turn_id,created,backend) VALUES(?,?,?,\'pending\',NULL,NULL,?,?)').run(id,owner,text,Date.now(),this.backendKey);this.acknowledge(ingressIds);this.db.exec('COMMIT');return id}catch(error){this.db.exec('ROLLBACK');throw error}}
 get(id){const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return r?{...r,input:JSON.parse(r.input),context:r.context?JSON.parse(r.context):null}:null}
 recheck(owner){return this.db.prepare("UPDATE jobs SET state=CASE WHEN turn_id IS NULL THEN 'bound' ELSE 'submitted' END WHERE owner=? AND backend=? AND state='uncertain' AND thread_id IS NOT NULL").run(owner,this.backendKey).changes}
 claimReceipt(id){return id?this.db.prepare('INSERT OR IGNORE INTO receipt_notices VALUES(?)').run(id).changes===1:false}
 pendingMaterials(owner,exceptId){const raw=this.rawPending().filter(m=>m.userId===owner&&m._ingressId!==exceptId&&(m.images?.length||m.files?.length||m.videos?.length||m.voices?.length));const prepared=this.pending().filter(j=>j.owner===owner&&j.id!==exceptId&&typeof j.input==='object'&&(j.input.attachments?.length||j.input.images?.length||j.input.audios?.length));return raw.length+prepared.length}
 uncertainCount(owner){return this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner=? AND backend=? AND state='uncertain'").get(owner,this.backendKey).count}
 pending(){return this.db.prepare("SELECT id FROM jobs WHERE backend=? AND state IN ('pending','bound','submitted') ORDER BY created,rowid").all(this.backendKey).map(r=>this.get(r.id))}
 context(id,context){this.db.prepare('UPDATE jobs SET context=? WHERE id=?').run(JSON.stringify(context),id)}
 bind(id,threadId){this.db.prepare("UPDATE jobs SET state='bound',thread_id=? WHERE id=? AND state='pending'").run(threadId,id)}
 submitted(id,turnId){this.db.prepare("UPDATE jobs SET state='submitted',turn_id=? WHERE id=? AND state='bound'").run(turnId,id)}
 mark(id,state){if(!['done','uncertain','cancelled'].includes(state))throw Error('INVALID_STATE');this.db.prepare("UPDATE jobs SET state=? WHERE id=? AND state NOT IN ('done','cancelled')").run(state,id)}
 findCaptured(message){const real=messageOwner(message),key=externalMessageId(message);if(key===undefined)return null
 const row=this.db.prepare('SELECT id,payload,state,backend FROM ingress WHERE id=?').get(ingressId(real,key))??this.db.prepare("SELECT id,payload,state,backend FROM ingress WHERE COALESCE(json_extract(payload,'$._conversationOwner'),json_extract(payload,'$.raw.from_user_id'),owner)=? AND CAST(COALESCE(json_extract(payload,'$.raw.message_id'),json_extract(payload,'$.raw.client_id')) AS TEXT)=? ORDER BY created LIMIT 1").get(real,String(key));return row?{...JSON.parse(row.payload),_ingressId:row.id,_captureState:row.state,_inboxBackend:row.backend}:null}
 capture(message){const key=requireExternalMessageId(message),prior=this.findCaptured(message);if(prior)return prior._inboxBackend===this.backendKey&&prior._captureState==='pending'?prior._ingressId:null;const real=messageOwner(message),id=ingressId(real,key);const value=Object.fromEntries(['userId','text','images','files','videos','voices','raw','references','_setupAction','_contextToken','_conversationOwner','_traceId'].filter(k=>message[k]!==undefined).map(k=>[k,message[k]])),payload=JSON.stringify(value);if(Buffer.byteLength(payload)>2*1024*1024)throw Error('ENVELOPE_TOO_LARGE');this.db.prepare("INSERT OR IGNORE INTO ingress(id,owner,payload,state,created,backend) VALUES(?,?,?,'pending',?,?)").run(id,message.userId,payload,Date.now(),this.backendKey);return this.db.prepare('SELECT state FROM ingress WHERE id=? AND backend=?').get(id,this.backendKey)?.state==='pending'?id:null}
 rawCurrent(id){return this.db.prepare('SELECT state FROM ingress WHERE id=?').get(id)?.state==='pending'}
 rawPending(){return this.db.prepare("SELECT id,payload FROM ingress WHERE backend=? AND state='pending' ORDER BY created,rowid").all(this.backendKey).map(r=>({...JSON.parse(r.payload),_ingressId:r.id,_recovered:true}))}
 acknowledge(ids){const stmt=this.db.prepare("UPDATE ingress SET state='done' WHERE id=? AND state='pending'");for(const id of ids??[])stmt.run(id)}
 cancel(owner){this.db.prepare("UPDATE ingress SET state='cancelled' WHERE owner=? AND backend=? AND state='pending'").run(owner,this.backendKey);this.db.prepare("UPDATE jobs SET state='cancelled' WHERE owner=? AND backend=? AND state NOT IN ('done','cancelled')").run(owner,this.backendKey)}
 close(){this.db.close()}
}
