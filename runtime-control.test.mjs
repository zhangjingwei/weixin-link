import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {RuntimeControl,controlRequest} from './runtime-control.mjs'
test('drain and seal use live counts; seal refuses work racing with an idle observation',()=>{
 let sessions=1,seals=0;const runtime=new RuntimeControl({snapshot:()=>({sessions}),ready:()=>true,onSeal:()=>{seals++}})
 const lease='test-lease-123';runtime.command('drain',lease);assert.equal(runtime.status().idle,false)
 sessions=0;assert.equal(runtime.status().idle,true);const leave=runtime.enter('delivery')
 assert.throws(()=>runtime.command('seal',lease),e=>e.statusCode===409);assert.equal(seals,0)
 leave();runtime.command('seal',lease);assert.equal(runtime.sealed,true);assert.equal(seals,1)
})
test('live work is released on failure and ingress reservation occurs before asynchronous work',async()=>{
 const runtime=new RuntimeControl();let release
 const task=runtime.track('media',async()=>{await new Promise(r=>{release=r});throw Error('decoder failed')})
 assert.equal(runtime.status().idle,false);release();await assert.rejects(task);assert.equal(runtime.status().idle,true)
})
test('maintenance has an owner, abandoned leases expire, and sealed service requires explicit resume',()=>{
 let now=0,resumes=0;const runtime=new RuntimeControl({now:()=>now,onResume:()=>{resumes++}})
 runtime.command('drain','lease-one');assert.throws(()=>runtime.command('drain','lease-two'),e=>e.statusCode===409)
 now=120001;assert.equal(runtime.draining,false);runtime.command('drain','lease-two');runtime.command('seal','lease-two')
 now=999999;assert.equal(runtime.draining,true);runtime.command('resume','lease-two');assert.equal(resumes,1);assert.equal(runtime.draining,false)
})
test('private Unix endpoint exposes current instance and readiness without consulting log files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wx-control-')),path=join(dir,'runtime.sock');let ready=false
 const runtime=new RuntimeControl({ready:()=>ready})
 try{await runtime.listen(path);assert.equal((await stat(path)).mode&0o777,0o600)
 const get=()=>controlRequest(path,'GET','/status');assert.equal((await get()).ready,false);ready=true
 const state=await get();assert.equal(state.ready,true);assert.equal(state.pid,process.pid);assert.equal(state.instance,runtime.instance)
 await controlRequest(path,'POST','/drain',{lease:'private-lease'});assert.equal((await get()).draining,true)
 await assert.rejects(controlRequest(path,'POST','/seal',{lease:'other-lease'}));await controlRequest(path,'POST','/resume',{lease:'private-lease'})
 }finally{await runtime.close();await rm(dir,{recursive:true,force:true})}
})

test('scheduled endpoints respect readiness and drain, and dispatch through their own callback',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'scheduled-control-'));let ready=false,calls=0
 const r=new RuntimeControl({ready:()=>ready,onScheduledStatus:async()=>({jobs:[{id:'news',state:'pending'}]}),onScheduledText:async body=>{calls++;return {accepted:body.jobId==='news'}}});const socket=join(dir,'runtime.sock')
 try{await r.listen(socket);await assert.rejects(controlRequest(socket,'POST','/scheduled-text',{jobId:'news'}));assert.equal(calls,0);ready=true;assert.equal((await controlRequest(socket,'GET','/scheduled-jobs')).jobs[0].id,'news');assert.equal((await controlRequest(socket,'POST','/scheduled-text',{jobId:'news'})).accepted,true);r.command('drain','scheduled-test-lease');await assert.rejects(controlRequest(socket,'POST','/scheduled-text',{jobId:'news'}));assert.equal(calls,1)}finally{await r.close();await rm(dir,{recursive:true,force:true})}
})
test('backend identity is observable without contaminating numeric idle counters',()=>{const r=new RuntimeControl({backend:{id:'pilot-a',kind:'podman'},ready:()=>true});assert.equal(r.status().backend.id,'pilot-a');assert.equal(r.status().idle,true);assert.deepEqual(r.status().counts,{})});
