import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'

test('failed initial handshake ends the queued task before submission and tells the sender',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'weixin-connect-'))
 const calls=[],replies=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:{},
  rpcFactory:()=>({close(){},request:async method=>{
   calls.push(method)
   throw Object.assign(Error('disconnected'),{connectionClosed:true})
  }})
 }).init()
 const jobs=new DurableJobs(join(dir,'jobs.sqlite'))
 const intake=new DurableIntake({jobs,manager,reply:async(owner,text)=>replies.push(text)})
 t.after(async()=>{intake.close();manager.close();jobs.close();await rm(dir,{recursive:true,force:true})})
 const id=intake.submit('owner','hello','message-id')
 await intake.users.get('owner')
 assert.deepEqual(calls,['initialize'])
 assert.equal(jobs.get(id).state,'cancelled')
 assert.equal(replies.length,1)
 assert.match(replies[0],/未能连接 Codex，本条消息尚未提交/)
})
