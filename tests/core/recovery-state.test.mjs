import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/core/durable-jobs.mjs'
import {SessionManager,controlCommand} from '../../src/base/codex/codex-session.mjs'
import {recoveryText} from '../../src/core/recovery-state.mjs'
test('recheck only reopens uncertain owner-linked work for reconciliation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'recheck-')),jobs=new DurableJobs(join(dir,'jobs.sqlite'))
 try{
 const linked=jobs.add('u','one'),other=jobs.add('v','two'),unbound=jobs.add('u','three')
 jobs.bind(linked,'thread');jobs.submitted(linked,'turn');jobs.mark(linked,'uncertain');jobs.mark(other,'uncertain');jobs.mark(unbound,'uncertain')
 assert.equal(jobs.recheck('u'),1);assert.equal(jobs.get(linked).turn_id,'turn');assert.equal(jobs.get(linked).state,'submitted');assert.equal(jobs.get(other).state,'uncertain');assert.equal(jobs.get(unbound).state,'uncertain')
 jobs.cancel('u');assert.equal(jobs.recheck('u'),0)
 }finally{jobs.close();await rm(dir,{recursive:true,force:true})}
})
test('result reports current task, does not replay stale result or start inference; partial sends fail',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'result-')),out=[]
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],rpcFactory:()=>{throw Error('must not execute')}}).init()
 try{
 m.state.users.u={lastReply:'old result',recovery:{task:{id:'1234',title:'新任务'},execution:'running',delivery:null}}
 await m.handle('u','/result',async t=>out.push(t));assert.equal(out.length,1);assert.ok(!out.includes('old result'));assert.match(out[0],/仍在执行/)
 m.state.users.u.recovery={execution:'completed',delivery:'unknown'};await m.handle('u','/result',async t=>{out.push(t);return {status:'accepted'}});assert.equal(m.state.users.u.recovery.delivery,'accepted')
 assert.equal(await m.emit({userId:'u',reply:async()=>({status:'partial'})},'x'),false)
 assert.match(recoveryText({execution:'failed',delivery:'recovered'}),/执行失败/)
 assert.match(recoveryText({execution:'completed',delivery:'failed'}),/发送失败.*\/result/)
 assert.equal(controlCommand('/recover').action,'recover')
 }finally{await rm(dir,{recursive:true,force:true})}
})
