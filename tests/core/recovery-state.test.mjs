import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {recoveryText} from '../../src/application/tasks/recovery-state.mjs'
test('recheck only reopens uncertain owner-linked work for reconciliation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'recheck-')),jobs=new DurableJobs(join(dir,'jobs.sqlite'))
 try{
 const linked=jobs.add('u','one'),other=jobs.add('v','two'),unbound=jobs.add('u','three')
 jobs.bind(linked,'thread');jobs.submitted(linked,'turn');jobs.mark(linked,'uncertain');jobs.mark(other,'uncertain');jobs.mark(unbound,'uncertain')
 assert.equal(jobs.recheck('u'),1);assert.equal(jobs.get(linked).turn_id,'turn');assert.equal(jobs.get(linked).state,'submitted');assert.equal(jobs.get(other).state,'uncertain');assert.equal(jobs.get(unbound).state,'uncertain')
 jobs.cancel('u');assert.equal(jobs.recheck('u'),0)
 }finally{jobs.close();await rm(dir,{recursive:true,force:true})}
})
test('partial and unknown sends preserve delivery uncertainty',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'result-'))
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],rpcFactory:()=>{throw Error('must not execute')}}).init()
 try{
 assert.equal(await m.emit({userId:'u',reply:async()=>({status:'partial'})},'x'),false)
 const unknown={userId:'u',reply:async()=>undefined}
 assert.equal(await m.emit(unknown,'x'),false)
 assert.equal(unknown.lastDelivery.status,'unknown')
 assert.match(recoveryText({execution:'failed',delivery:'recovered'}),/执行失败/)
 assert.match(recoveryText({execution:'completed',delivery:'failed'}),/发送失败.*结果/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
