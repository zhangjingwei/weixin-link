import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {recover} from '../../src/application/tasks/local-recovery.mjs'

test('checkpointed stop survives restart and interrupts only its original active turn', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'stop-checkpoint-'))
  const path=join(dir,'jobs.sqlite')
  let jobs=new DurableJobs(path)
  t.after(async()=>{jobs.close();await rm(dir,{recursive:true,force:true})})
  const active=jobs.add('owner','active'), queued=jobs.add('owner','queued'), other=jobs.add('other','other')
  jobs.bind(active,'thread')
  jobs.submitted(active,'turn')
  const stop={userId:'owner',text:'停止',raw:{message_id:'stop'}}
  const {id}=jobs.captureStop(stop)
  const later=jobs.add('owner','later')
  jobs.close()
  jobs=new DurableJobs(path)
  assert.deepEqual(jobs.captureStop(stop),{id,fresh:false})
  assert.equal(jobs.rawPending()[0]._ingressId,id)
  assert.equal(jobs.get(queued).state,'cancelled')
  assert.equal(jobs.get(later).state,'pending')
  assert.equal(jobs.get(other).state,'pending')
  const calls=[]
  const manager={connect:async()=>({threadId:'thread',rpc:{}}),protocol:{
    recoverTurn:async()=>({id:'turn',status:'inProgress'}),
    interrupt:async(_rpc,thread,turn)=>{calls.push([thread,turn]);throw Error('connection lost')},
  }}
  await assert.rejects(recover({jobs,manager},jobs.get(active),()=>{},{current:()=>true}),/connection lost/)
  assert.deepEqual(calls,[['thread','turn']])
  assert.equal(jobs.get(active).stop_request,null)
  assert.equal(jobs.get(active).state,'submitted')
})
