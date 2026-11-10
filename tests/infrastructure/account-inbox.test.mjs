import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {openAccountInbox} from '../../src/infrastructure/storage/account-inbox.mjs'

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'account-inbox-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
test('one account cannot see another account inbox',async t=>{
 const dir=await fixture(t),a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b)
 const first=await openAccountInbox(a),second=await openAccountInbox(b)
 try{first.add('owner',{text:'private'},'same');assert.equal(second.pending().length,0);for(const table of ['jobs','ingress'])assert(!first.db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='backend'))}finally{first.close();second.close()}
})
test('existing account inbox rows remain assigned to the host backend',async t=>{
 const dir=await fixture(t),path=join(dir,'inbox.sqlite')
 const db=new DatabaseSync(path)
 db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT,input TEXT,state TEXT,thread_id TEXT,turn_id TEXT,created INTEGER,context TEXT);CREATE TABLE ingress(id TEXT PRIMARY KEY,owner TEXT,payload TEXT,state TEXT,created INTEGER);CREATE TABLE receipt_notices(id TEXT PRIMARY KEY)")
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)').run('old-host','owner','{}','submitted',null,null,1,null)
 db.close()
 const inbox=await openAccountInbox(dir)
 try{assert.equal(inbox.pending().length,1)}finally{inbox.close()}
})
