import {DatabaseSync} from 'node:sqlite'
import {access,lstat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {DurableJobs} from './durable-jobs.mjs'
import {createHash} from 'node:crypto'

const tables={
 jobs:['id','owner','input','state','thread_id','turn_id','created','context','backend'],
 ingress:['id','owner','payload','state','created','backend'],
 receipt_notices:['id'],
 weixin_sent:['client_id','peer','message_id','state','text','created'],
}

function columns(db,table){return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name))}
function copyTable(target,source,table,backendKey){
 const available=columns(source,table)
 if(!available.size){if(table==='weixin_sent')return;throw Error('LEGACY_INBOX_SCHEMA_INVALID')}
 const fields=tables[table],required=fields.filter(field=>!['context','backend'].includes(field))
 if(required.some(field=>!available.has(field)))throw Error('LEGACY_INBOX_SCHEMA_INVALID')
 const select=source.prepare(`SELECT * FROM ${table}`)
 const read=target.prepare(`SELECT ${fields.join(',')} FROM ${table} WHERE ${fields[0]}=?`)
 const write=target.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`)
 for(const row of select.iterate()){
  const values=fields.map(field=>field==='backend'?backendKey:row[field]??null)
  const prior=read.get(values[0])
  if(prior){if(fields.some((field,index)=>prior[field]!==values[index]))throw Error('ACCOUNT_INBOX_MIGRATION_CONFLICT');continue}
  write.run(...values)
 }
}

function sourceSignature(source){
 const hash=createHash('sha256')
 for(const table of Object.keys(tables)){
  hash.update(table+'\0')
  if(!columns(source,table).size)continue
  for(const row of source.prepare(`SELECT * FROM ${table} ORDER BY ${tables[table][0]}`).iterate())hash.update(JSON.stringify(row)+'\n')
 }
 return hash.digest('hex')
}
function migrateSource(target,path,sourceId,backendKey){
 const source=new DatabaseSync(path,{readOnly:true})
 try{
  const signature=sourceSignature(source),prior=target.prepare('SELECT signature FROM inbox_migrations WHERE source=?').get(sourceId)
  if(prior){if(prior.signature!==signature)throw Error('LEGACY_INBOX_CHANGED_AFTER_MIGRATION');return}
  target.exec('BEGIN IMMEDIATE')
  try{
   for(const table of Object.keys(tables))copyTable(target,source,table,backendKey)
   target.prepare('INSERT INTO inbox_migrations VALUES(?,?,?)').run(sourceId,signature,Date.now())
   target.exec('COMMIT')
  }catch(error){target.exec('ROLLBACK');throw error}
 }finally{source.close()}
}

/** Keep ingress, task and WeChat send ledgers under the account, independent of agent selection. */
export async function openAccountInbox(accountDir,{backendKey}={}){
 const jobs=new DurableJobs(join(accountDir,'inbox.sqlite'),{backendKey})
 try{
  jobs.db.exec("CREATE TABLE IF NOT EXISTS weixin_sent(client_id TEXT PRIMARY KEY,peer TEXT NOT NULL,message_id TEXT,state TEXT NOT NULL,text TEXT,created INTEGER NOT NULL)")
  let entries=[]
  try{entries=await readdir(join(accountDir,'backends'),{withFileTypes:true})}catch(error){if(error.code!=='ENOENT')throw error}
  for(const entry of entries){
   if(!entry.isDirectory()||!/^(?:pilot-[ab]|agent-[a-f0-9]{16})$/.test(entry.name))continue
   const sourceId=`backends/${entry.name}/inbox.sqlite`,path=join(accountDir,sourceId)
   let info;try{info=await lstat(path)}catch(error){if(error.code==='ENOENT')continue;throw error}
   if(!info.isFile())throw Error('LEGACY_INBOX_PATH_UNSAFE')
   migrateSource(jobs.db,path,sourceId,`codex:${entry.name}`)
  }
  return jobs
 }catch(error){jobs.close();throw error}
}

/** Used while a service is sealed: do not leave unresolved work in the backend being switched away from. */
export async function unresolvedAccountInbox(accountDir,backendKey){
 const path=join(accountDir,'inbox.sqlite')
 try{await access(path)}catch(error){if(error.code==='ENOENT')return false;throw error}
 const db=new DatabaseSync(path,{readOnly:true})
 try{
  const jobBackend=columns(db,'jobs').has('backend')?'backend=?':"'codex:host'=?"
  const ingressBackend=columns(db,'ingress').has('backend')?'backend=?':"'codex:host'=?"
  const jobs=db.prepare(`SELECT 1 FROM jobs WHERE ${jobBackend} AND state NOT IN ('done','cancelled') LIMIT 1`).get(backendKey)
  const ingress=db.prepare(`SELECT 1 FROM ingress WHERE ${ingressBackend} AND state='pending' LIMIT 1`).get(backendKey)
  return !!(jobs||ingress)
 }finally{db.close()}
}

export async function legacyInboxMigrated(accountDir,backendId){
 const path=join(accountDir,'inbox.sqlite')
 try{await access(path)}catch(error){if(error.code==='ENOENT')return false;throw error}
 const db=new DatabaseSync(path,{readOnly:true})
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbox_migrations'").get())return false
  return !!db.prepare('SELECT 1 FROM inbox_migrations WHERE source=?').get(`backends/${backendId}/inbox.sqlite`)
 }finally{db.close()}
}
