import test from 'node:test'
import assert from 'node:assert/strict'
import {ASSISTANT_INSTRUCTIONS} from '../../src/core/policy/assistant-policy.mjs'
import {currentMaterials,materialInput} from '../../src/core/tasks/material-context.mjs'

test('material labels never expose Windows or POSIX parent paths', () => {
  const rows = currentMaterials({attachments: [{path: 'C:\\Users\\alice\\private\\photo.png', kind: 'images'}, {path: '/tmp/private/secret.pdf', name: 'C:\\Users\\alice\\secret.pdf', kind: 'files'}]}, 'delivery-1')
  assert.deepEqual(rows.map(item => item.name), ['photo.png', 'secret.pdf'])
  assert.equal(materialInput({materials: rows}).text.includes('Users'), false)
})
test('material IDs are stable per delivery, distinct across deliveries, and deduplicate visual aliases',()=>{
 const input={attachments:[{path:'/private/a.jpg',name:'a.jpg',kind:'images'}],images:['/private/a.jpg']}
 const a=currentMaterials(input,'one');assert.equal(a.length,1);assert.deepEqual(a,currentMaterials(input,'one'));assert.notEqual(a[0].id,currentMaterials(input,'two')[0].id);assert.ok(!JSON.stringify(a).includes('/private'))
 assert.deepEqual(currentMaterials('总结聊天记录','one'),[])
})
test('unbound request cannot silently reuse historical files; pending is not a grouping assertion',()=>{
 const text=materialInput({pending:1}).text
 assert.ok(ASSISTANT_INSTRUCTIONS.includes('禁止自行读取或总结历史文件'));assert.ok(ASSISTANT_INSTRUCTIONS.includes('waiting_attachment'));assert.ok(ASSISTANT_INSTRUCTIONS.includes('待处理附件数量不代表同组或授权'));assert.ok(text.length<200);assert.ok(text.includes('"current":[]'))
})
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/core/intake/durable-jobs.mjs'
test('pending material count is owner-isolated and excludes current delivery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'material-queue-')),jobs=new DurableJobs(join(dir,'queue.sqlite'))
 try{
 jobs.capture({userId:'u',raw:{message_id:'one'},files:[{name:'one.zip'}]})
 jobs.capture({userId:'other',raw:{message_id:'two'},images:[{}]})
 const id=jobs.add('u',{text:'查看附件',attachments:[{path:'/tmp/a.zip'}]},'job')
 assert.equal(jobs.pendingMaterials('u',id),1);assert.equal(jobs.pendingMaterials('other',id),1);assert.equal(jobs.pendingMaterials('none',id),0)
 }finally{jobs.close();await rm(dir,{recursive:true,force:true})}
})
import {SessionManager} from '../../src/base/codex/codex-session.mjs'
test('official submission carries original text, scoped material context and durable binding snapshot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'material-submit-')),calls=[];let snapshot
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],remoteControl:async()=>({}),rpcFactory:()=>({closed:false,write(){},close(){},async request(method,params){calls.push({method,params});return method.startsWith('thread/')?{thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}:{turn:{id:'turn'}}}})}).init()
 try{
 m.submissions={context(id,data){snapshot=data},bind(){},submitted(){},pendingMaterials(owner,id){assert.equal(owner,'u');assert.equal(id,'delivery');return 1}}
 await m.handle('u',{text:'总结聊天记录',deliveryId:'delivery'},async()=>{})
 const input=calls.find(c=>c.method==='turn/start').params.input
 assert.equal(input[0].text,'总结聊天记录');assert.ok(input.some(i=>i.text?.includes('"pendingMessages":1')));assert.ok(input.some(i=>i.text?.includes('"current":[]')));assert.equal(snapshot.task.id,m.sessions.get('u').localTask.id);assert.deepEqual(snapshot.materials,[])
 }finally{m.close();await m.saving;await rm(dir,{recursive:true,force:true})}
})
test('attachment received during inference changes stale waiting copy without ending the logical task',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'material-notice-')),out=[]
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],completionMarkers:true,remoteControl:async()=>({}),rpcFactory:()=>({closed:false,write(){},close(){},async request(method){return method.startsWith('thread/')?{thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}:{turn:{id:'turn'}}}})}).init()
 try{
 await m.handle('u','总结文件',async t=>out.push(t));const session=m.sessions.get('u')
 m.submissions={pendingMaterials:()=>1}
 await m.event(session,{method:'turn/started',params:{threadId:'t',turn:{id:'turn'}}})
 await m.event(session,{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',phase:'final_answer',text:`已收到总结要求，正在等待聊天记录附件到达。<wechat-task:${session.traceId}>waiting_attachment</wechat-task:${session.traceId}>`}}})
 await m.event(session,{method:'turn/completed',params:{threadId:'t',turn:{id:'turn',status:'completed'}}})
 assert.equal(out.length,0);assert.ok(!out.join('').includes('等待聊天记录附件到达'));assert.ok(!out.join('').includes('本轮回答结束'));assert.equal(m.state.users.u.recovery.execution,'waiting_attachment')
 }finally{m.close();await m.saving;await rm(dir,{recursive:true,force:true})}
})
