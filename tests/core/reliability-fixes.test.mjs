import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MessageDispatch} from '../../src/wechat/message-dispatch.mjs'
import {singleMedia} from '../../src/application/intake/single-media.mjs'
import {DurableJobs} from '../../src/core/intake/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {SessionManager} from '../../src/base/codex/codex-session.mjs'
test('slow attachment retains order; another user and cancellation remain independent',async()=>{
 const dispatch=new MessageDispatch(),order=[],token={current:()=>true};let release
 const gate=new Promise(r=>release=r)
 const media=dispatch.enqueue('u',()=>singleMedia({userId:'u'},token,{prepare:async()=>{await gate;return {attachments:[{}]}},compose:async()=>({}),submit:async()=>order.push('media')},()=>({instructionText:'',messageId:undefined})),token)
 const text=dispatch.enqueue('u',()=>order.push('text'),token)
 await dispatch.enqueue('other',()=>order.push('other'),token)
 assert.deepEqual(order,['other']);release();await Promise.all([media,text]);assert.deepEqual(order,['other','media','text'])
})
test('submission failure retains original waiting attachment request',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'waiting-failure-'))
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],remoteControl:async()=>{throw Error('offline')},rpcFactory:()=>({closed:false,write(){},close(){},async request(){return {thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}}})}).init()
 try{
 const waiting={task:{id:'original',title:'总结'},request:'总结文件',threadId:'t'};m.state.users.u={waitingAttachment:waiting}
 const session=await m.connect('u',async()=>{});await assert.rejects(()=>m.send(session,{text:'附件',attachments:[{path:'/tmp/x'}]}));assert.equal(m.state.users.u.waitingAttachment,waiting)
 }finally{m.close();await m.saving;await rm(dir,{recursive:true,force:true})}
})
test('restart recovers original logical task and waiting state without completion notice',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'task-recovery-'));let jobs=new DurableJobs(join(dir,'queue.sqlite'))
 try{
 const id=jobs.add('u',{text:'附件'},'delivery'),task={id:'original',title:'总结'}
 jobs.context(id,{task,request:'总结文件',flowNonce:'nonce'});jobs.bind(id,'thread');jobs.submitted(id,'turn');jobs.close();jobs=new DurableJobs(join(dir,'queue.sqlite'))
 const state={users:{u:{}}},out=[],session={threadId:'thread',rpc:{async request(){return {data:[{id:'turn',status:'completed',items:[{type:'agentMessage',text:'等待附件。<wechat-task:nonce>waiting_attachment</wechat-task:nonce>'}]}]}}}}
 const intake=new DurableIntake({jobs,manager:{state,connect:async()=>session,save:async()=>{}},reply:async()=>{}})
 await intake.recover(jobs.get(id),async t=>out.push(t),{current:()=>true})
 assert.equal(state.users.u.lastTask.id,'original');assert.equal(state.users.u.waitingAttachment.request,'总结文件');assert.equal(out.length,0);assert.equal(jobs.get(id).state,'done')
 }finally{jobs.close();await rm(dir,{recursive:true,force:true})}
})
