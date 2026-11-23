import test from 'node:test'
import assert from 'node:assert/strict'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {createManagementMcpController} from '../../src/interfaces/controllers/management-mcp-controller.mjs'

function fixture(t){
 const calls=[],notices=[],manager=new SessionManager({stateDir:'/unused',cwd:'/workspace',owners:['alice','bob'],providerEnv:{},rpcFactory:()=>{throw Error('read must not connect')}})
 manager.save=async()=>{calls.push('save')};manager.state.users={alice:{threadId:'a'},project:{threadId:'b',workspace:'/knowledge'},bob:{threadId:'private'}}
 const backend={capabilities:{catalog:false,history:true},withConnection:async(owner,recipient,work)=>work({}),confirmSession:async s=>({id:s.threadId,cwd:'/verified'}),listTurns:async()=>({data:[]})}
 const conversations=new TextConversations(manager,['alice','bob'],()=>({}),backend)
 conversations.root.alice.entries.push({id:'2',key:'project',name:'知识库'});manager.owners.add('project')
 const service=new ManagementService({manager,conversations,notice:async(owner,text)=>notices.push([owner,text])});t.after(()=>service.close())
 const session={userId:'alice',rpc:{closed:false},state:'running',busy:true,turnReady:true,turnStarted:true,threadId:'a',turnId:'turn-a',traceId:'task-a',workToken:manager.lifecycle.capture('alice'),queue:[],reply:async()=>{}}
 manager.sessions.set('alice',session)
 return {service,manager,conversations,calls,notices,session,backend}
}
test('read-only resolution filters owners, preserves active selection, and reports ambiguity',async t=>{
 const {service,manager,conversations,calls}=fixture(t)
 assert.equal((await service.call('alice','resolve_target',{query:'知识库'})).resolution,'unique')
 conversations.root.alice.entries.push({id:'3',key:'duplicate',name:'知识库'});manager.state.users.duplicate={}
 assert.equal((await service.call('alice','resolve_target',{query:'知识库'})).resolution,'ambiguous')
 assert.equal((await service.call('alice','resolve_target',{query:'unknown'})).resolution,'not_found')
 assert.equal((await service.call('alice','list_projects',{})).projects.length,3)
 await assert.rejects(service.call('alice','get_project_status',{projectId:'private'}),/NOT_FOUND/)
 assert.equal(conversations.root.alice.active,'1');assert.deepEqual(calls,[])
})
test('untrusted owner fields, tools and forged cursors are rejected',async t=>{
 const {service}=fixture(t)
 await assert.rejects(service.call('alice','list_projects',{ownerId:'bob'}),/INVALID_ARGUMENTS/)
 await assert.rejects(service.call('alice','rpc',{method:'thread/resume'}),/INVALID_ARGUMENTS/)
 await assert.rejects(service.call('alice','get_session_history',{projectId:'2',cursor:'forged'}),/INVALID_CURSOR/)
 await assert.rejects(service.call('outsider','list_projects',{}),/FORBIDDEN/)
})
test('large history is returned fully across bound cursors; attachments and metadata do not execute',async t=>{
 const {service,backend}=fixture(t),body='完整上下文'.repeat(5000)
 backend.listTurns=async()=>({data:[{id:'t',items:[{type:'userMessage',content:[{type:'text',text:'原请求接入层任务状态元数据 nonce=test'}]},{type:'agentMessage',text:body+'[附件](/private/a.md)'}]}]})
 let cursor,text='',pages=0
 do{const page=await service.call('alice','get_session_history',{projectId:'2',...(cursor?{cursor}:{})});cursor=page.nextCursor;text+=page.messages.filter(m=>m.role==='assistant').map(m=>m.text).join('');assert.equal(page.attachmentsResent,false);pages++;if(cursor)await assert.rejects(service.call('bob','get_session_history',{projectId:'1',cursor}),/INVALID_CURSOR/)}while(cursor&&pages<10)
 assert.equal(text,body+'附件〔历史附件，未重发〕');assert(pages>1)
})
test('supplement uses exact existing turn and deduplicates request IDs',async t=>{
 const {service,manager,session}=fixture(t);let steers=0
 manager.protocol.steer=async(rpc,threadId,turnId,text)=>{steers++;assert.equal(turnId,'turn-a');return {turnId}}
 const args={projectId:'1',taskId:'task-a',turnId:'turn-a',text:'补充原任务',requestId:'one'}
 assert.equal((await service.call('alice','supplement_task',args)).status,'accepted')
 assert.equal((await service.call('alice','supplement_task',{...args})).status,'accepted');assert.equal(steers,1)
 await assert.rejects(service.call('alice','supplement_task',{...args,text:'different'}),/CONFLICT/)
 session.turnId='turn-next'
 await assert.rejects(service.call('alice','supplement_task',{...args,requestId:'two'}),/STALE_TASK/)
 assert.equal(steers,1)
})
test('a task finishing during supplement persistence never feeds the next turn',async t=>{
 const {service,manager,session}=fixture(t);let n=0,steers=0
 manager.save=async()=>{if(++n===2)session.turnId='next'}
 manager.protocol.steer=async()=>{steers++}
 const result=await service.call('alice','supplement_task',{projectId:'1',taskId:'task-a',turnId:'turn-a',text:'details',requestId:'one'})
 assert.equal(steers,0);assert.notEqual(result.status,'accepted')
})
test('switch returns pending, waits for caller completion and uses confirmed selection use case',async t=>{
 const {service,manager,session,conversations,notices}=fixture(t)
 const target={userId:'project',threadId:'b',rpc:{closed:false},queue:[],reply:async()=>{}};manager.sessions.set('project',target)
 const result=await service.call('alice','request_project_switch',{projectId:'2',requestId:'switch-one'})
 assert.equal(result.status,'pending');assert.equal(conversations.root.alice.active,'1')
 const op=service.operations[0];await service.execute(op);assert.equal(op.status,'pending')
 session.busy=false;session.state='idle';await service.execute(op)
 assert.equal(op.status,'confirmed');assert.equal(conversations.root.alice.active,'2');assert.match(notices[0][1],/已切换到知识库/)
})
test('a newer explicit selection supersedes pending switch',async t=>{
 const {service,session,conversations}=fixture(t)
 await service.call('alice','request_project_switch',{projectId:'2',requestId:'switch-one'})
 session.busy=false;conversations.root.alice.selectionVersion=1
 await service.execute(service.operations[0]);assert.equal(service.operations[0].status,'not_executed');assert.equal(conversations.root.alice.active,'1')
})
test('stop runs only after activation, reuses cancellation and preserves original reply',async t=>{
 const {service,manager,session}=fixture(t);let interrupts=0,cancelled=0
 manager.protocol.interrupt=async()=>{interrupts++};manager.lifecycle.listeners.add(()=>cancelled++)
 const reply=session.reply,args={projectId:'1',taskId:'task-a',turnId:'turn-a',requestId:'stop-one'}
 const result=await service.call('alice','request_task_stop',args)
 assert.equal(result.status,'pending');assert.equal(interrupts,0)
 await service.execute(service.operations[0]);assert.equal(interrupts,1);assert.equal(cancelled,1);assert.equal(service.operations[0].status,'requested');assert.equal(session.reply,reply)
})
test('deferred stop rejects stale target without cancelling another task',async t=>{
 const {service,manager,session}=fixture(t);let cancelled=0;manager.lifecycle.listeners.add(()=>cancelled++)
 await service.call('alice','request_task_stop',{projectId:'1',taskId:'task-a',turnId:'turn-a',requestId:'stop-one'})
 session.turnId='replacement';await service.execute(service.operations[0]);assert.equal(cancelled,0);assert.equal(service.operations[0].status,'not_executed')
})
test('restart retains uncertain writes and never replays them',t=>{
 const {service,manager,conversations}=fixture(t)
 service.operations.push({id:'pending',status:'pending'},{id:'executing',status:'executing'})
 const restored=new ManagementService({manager,conversations});t.after(()=>restored.close())
 assert.deepEqual(restored.operations.map(o=>o.status),['not_executed','unknown'])
})
test('capabilities bind live attempts; owner and caller cannot be forged',async t=>{
 const {service,manager,session}=fixture(t),attempt={current:true}
 const controller=createManagementMcpController({manager,service,configuration:capability=>({capability})}),binding=controller.bind(session,attempt)
 assert.equal((await controller.onRequest({...binding,tool:'list_projects',args:{}})).projects.length,2)
 attempt.current=false;await assert.rejects(controller.onRequest({...binding,tool:'list_projects',args:{}}),/FORBIDDEN/)
})
test('concurrent writes with one request ID and different arguments are not conflated',async t=>{
 const {service,manager}=fixture(t);let release
 manager.save=()=>new Promise(resolve=>{release=resolve})
 const args={projectId:'2',requestId:'same'}
 const first=service.call('alice','request_project_switch',args)
 await assert.rejects(service.call('alice','request_project_switch',{...args,projectId:'1'}),/CONFLICT/)
 release();assert.equal((await first).status,'pending')
})
test('a new selection during durable switch bookkeeping cannot be overwritten',async t=>{
 const {service,manager,session,conversations}=fixture(t)
 await service.call('alice','request_project_switch',{projectId:'2',requestId:'switch-one'})
 session.busy=false;let saves=0;manager.save=async()=>{if(++saves===1)conversations.root.alice.selectionVersion=1}
 await service.execute(service.operations[0]);assert.equal(conversations.root.alice.active,'1');assert.notEqual(service.operations[0].status,'confirmed')
})
test('history continuation rejects a changed active turn rather than skipping new text',async t=>{
 const {service,backend}=fixture(t);let text='原文'.repeat(10000)
 backend.listTurns=async()=>({data:[{id:'turn',items:[{type:'agentMessage',text}]}]})
 const first=await service.call('alice','get_session_history',{projectId:'2'});text='修改'+text
 await assert.rejects(service.call('alice','get_session_history',{projectId:'2',cursor:first.nextCursor}),/HISTORY_CHANGED/)
})
