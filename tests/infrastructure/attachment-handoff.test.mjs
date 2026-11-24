import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {attachmentHandoffs} from '../../src/infrastructure/media/attachment-handoff.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
test('handoff privately snapshots only current owned receipts, survives retry, and retains unknown consumers',async t=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=join(root,'attachments',hash('source').slice(0,24),'receipt');await mkdir(dir,{recursive:true});const path=join(dir,'file.txt');await writeFile(path,'private receipt')
 const jobs=new DurableJobs(join(root,'jobs.db'));t.after(()=>jobs.close());let time=Date.now();const service=attachmentHandoffs(root,jobs,{now:()=>time}),args={sourceKey:'source',targetKey:'target',ingressId:'a'.repeat(64),input:{text:'附件：'+path,attachments:[{path,name:'file.txt'}],images:[]}}
 const first=await service.prepare(args),again=await service.prepare(args);assert.equal(first.attachments[0].path,again.attachments[0].path);assert.notEqual(first.attachments[0].path,path);assert.equal(await readFile(first.attachments[0].path,'utf8'),'private receipt');assert(first.text.includes(first.attachments[0].path))
 const id=jobs.add('target',first,'job');jobs.mark(id,'uncertain');await service.cleanup();await access(first.attachments[0].path)
 await symlink('/etc/hosts',join(dir,'link'));await assert.rejects(service.prepare({...args,ingressId:'b'.repeat(64),input:{text:'',attachments:[{path:join(dir,'link')}]}}),/HANDOFF_UNSAFE/)
 jobs.markOutcome(id,'completed');jobs.mark(id,'done');await service.cleanup();time+=8*86400000;await service.cleanup();await assert.rejects(access(first.attachments[0].path));
 assert.equal(await readFile(path,'utf8'),'private receipt')
})
