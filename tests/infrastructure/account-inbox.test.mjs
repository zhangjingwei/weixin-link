import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {openAccountInbox,unresolvedAccountInbox} from '../../src/infrastructure/storage/account-inbox.mjs'

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'account-inbox-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
function legacy(path,{jobId,ingressId}={}){
 const db=new DatabaseSync(path)
 db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT,input TEXT,state TEXT,thread_id TEXT,turn_id TEXT,created INTEGER,context TEXT);CREATE TABLE ingress(id TEXT PRIMARY KEY,owner TEXT,payload TEXT,state TEXT,created INTEGER);CREATE TABLE receipt_notices(id TEXT PRIMARY KEY);CREATE TABLE weixin_sent(client_id TEXT PRIMARY KEY,peer TEXT,message_id TEXT,state TEXT,text TEXT,created INTEGER)")
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)').run(jobId,'owner','{}','submitted','thread','turn',1,null)
 db.prepare('INSERT INTO ingress VALUES(?,?,?,?,?)').run(ingressId,'owner',JSON.stringify({userId:'owner',raw:{message_id:ingressId}}),'pending',1)
 db.prepare('INSERT INTO receipt_notices VALUES(?)').run(ingressId)
 db.prepare('INSERT INTO weixin_sent VALUES(?,?,?,?,?,?)').run('send-'+ingressId,'owner',null,'unknown','notice',1)
 db.close()
}

test('Codex container ledger migrates without changing host task ownership',async t=>{
 const dir=await fixture(t),podmanDir=join(dir,'backends','pilot-a')
 await mkdir(podmanDir,{recursive:true})
 const host=new DurableJobs(join(dir,'inbox.sqlite'))
 host.add('owner',{text:'host'},'host-job');host.mark(host.pending()[0].id,'uncertain');host.close()
 legacy(join(podmanDir,'inbox.sqlite'),{jobId:'podman-job',ingressId:'podman-ingress'})
 let inbox=await openAccountInbox(dir,{backendKey:'codex:host'})
 assert.equal(inbox.pending().length,0)
 assert.equal(inbox.get('podman-job').backend,'codex:pilot-a')
 assert.equal(inbox.capture({userId:'owner',raw:{message_id:'podman-ingress'}}),null)
 assert.equal(inbox.db.prepare('SELECT COUNT(*) AS n FROM inbox_migrations').get().n,1)
 assert.equal(await unresolvedAccountInbox(dir,'codex:host'),true)
 inbox.close()
 inbox=await openAccountInbox(dir,{backendKey:'codex:pilot-a'})
 assert.deepEqual(inbox.pending().map(job=>job.id),['podman-job'])
 assert.deepEqual(inbox.rawPending().map(row=>row._ingressId),['podman-ingress'])
 inbox.close()
})

test('migration conflict leaves account records unchanged',async t=>{
 const dir=await fixture(t),podmanDir=join(dir,'backends','pilot-a');await mkdir(podmanDir,{recursive:true})
 const target=new DurableJobs(join(dir,'inbox.sqlite'))
 target.db.prepare("INSERT INTO jobs(id,owner,input,state,created) VALUES(?,?,?,'done',?)").run('same','owner','"account"',1)
 target.close()
 legacy(join(podmanDir,'inbox.sqlite'),{jobId:'same',ingressId:'legacy-ingress'})
 await assert.rejects(openAccountInbox(dir,{backendKey:'codex:host'}),/MIGRATION_CONFLICT/)
 const db=new DatabaseSync(join(dir,'inbox.sqlite'),{readOnly:true})
 try{assert.equal(db.prepare('SELECT input FROM jobs WHERE id=?').get('same').input,'"account"');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_migrations').get().n,0)}finally{db.close()}
})

test('writes to a Codex legacy inbox after migration are detected',async t=>{
 const dir=await fixture(t),podmanDir=join(dir,'backends','pilot-a');await mkdir(podmanDir,{recursive:true})
 const path=join(podmanDir,'inbox.sqlite');legacy(path,{jobId:'old-job',ingressId:'old-ingress'})
 const inbox=await openAccountInbox(dir,{backendKey:'codex:host'});inbox.close()
 const source=new DatabaseSync(path);source.prepare('INSERT INTO receipt_notices VALUES(?)').run('later');source.close()
 await assert.rejects(openAccountInbox(dir,{backendKey:'codex:host'}),/LEGACY_INBOX_CHANGED_AFTER_MIGRATION/)
})

test('one account cannot see another account inbox',async t=>{
 const dir=await fixture(t),a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b)
 const first=await openAccountInbox(a,{backendKey:'codex:host'}),second=await openAccountInbox(b,{backendKey:'codex:host'})
 try{first.add('owner',{text:'private'},'same');assert.equal(second.pending().length,0)}finally{first.close();second.close()}
})

test('existing account inbox rows remain assigned to the host backend',async t=>{
 const dir=await fixture(t),path=join(dir,'inbox.sqlite')
 const db=new DatabaseSync(path)
 db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT,input TEXT,state TEXT,thread_id TEXT,turn_id TEXT,created INTEGER,context TEXT);CREATE TABLE ingress(id TEXT PRIMARY KEY,owner TEXT,payload TEXT,state TEXT,created INTEGER);CREATE TABLE receipt_notices(id TEXT PRIMARY KEY)")
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)').run('old-host','owner','{}','submitted',null,null,1,null)
 db.close()
 assert.equal(await unresolvedAccountInbox(dir,'codex:host'),true)
 const inbox=await openAccountInbox(dir,{backendKey:'codex:host'})
 try{assert.equal(inbox.pending().length,1);assert.equal(inbox.get('old-host').backend,'codex:host')}finally{inbox.close()}
})
