import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {ensurePlatformProjects} from '../../src/domain/conversations/platform-projects.mjs'
import {taskOutcome,turnExecution} from '../../src/domain/tasks/task-control.mjs'
import {taskProgress,heartbeatDue} from '../../src/domain/tasks/progress-state.mjs'
import {stripTaskFlow} from '../../src/infrastructure/agents/task-flow.mjs'
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'platform-core-'));await mkdir(join(dir,'repo'))
 let turn=0;const sent=[]
 const manager=await new SessionManager({stateDir:join(dir,'state'),cwd:dir,owners:['alice','bob'],providerEnv:{},rpcFactory:()=>({closed:false,close(){this.closed=true},write(){},async request(method){if(method.startsWith('thread/'))return {thread:{id:'native'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};return {turn:{id:'turn'+(++turn)}}}})}).init()
 const backend={capabilities:{catalog:false,history:false},confirmSession:async()=>assert.fail('platform operations must not connect'),withConnection:async()=>assert.fail('platform operations must not call a native backend')}
 const conversations=new TextConversations(manager,['alice','bob'],()=>({}),backend),jobs=new DurableJobs(join(dir,'tasks.sqlite'));manager.submissions=jobs
 const enqueued=[],service=new ManagementService({manager,conversations,enqueueTask:(owner,input,key)=>{const id=jobs.add(owner,input,key);enqueued.push(id);return id}})
 t.after(async()=>{service.close();manager.close();await manager.saving;jobs.close();await rm(dir,{recursive:true,force:true})})
 const begin=async(text='ordinary request')=>{const id=jobs.add('alice',{text},'job'+turn);await manager.handle('alice',{text,deliveryId:id},async text=>{sent.push(text);return {status:'accepted'}});const s=manager.sessions.get('alice');return {id,s,args:{projectId:'1',sourceTaskId:id,turnId:s.turnId,requestId:'control'+turn}}}
 const finish=async(text,status='completed')=>{const s=manager.sessions.get('alice');if(text)await manager.event(s,{method:'item/completed',params:{threadId:s.threadId,item:{type:'agentMessage',phase:'final_answer',text}}});await manager.event(s,{method:'turn/completed',params:{threadId:s.threadId,turn:{id:s.turnId,status}}})}
 return {dir,manager,conversations,jobs,service,begin,finish,sent,enqueued}
}
test('platform project creation, rename, sessions and history work with every native access forbidden, and persist identity',async t=>{
 const f=await fixture(t),{service,manager,conversations}=f
 const choices=await service.call('alice','list_workspace_choices',{projectId:'1'}),token=choices.items.find(c=>c.name==='repo').workspaceToken
 const created=await service.call('alice','create_project',{name:'My project',workspaceToken:token,requestId:'create'})
 assert.equal(created.status,'confirmed');assert.equal(created.data.nativeProjectId,null);assert.equal(manager.sessions.size,0)
 const {platformProjectId,projectId}=created.data
 const opened=await service.call('alice','create_project_session',{platformProjectId,requestId:'new-session'})
 assert.equal(opened.status,'confirmed');assert.equal(opened.data.threadId,null);assert.equal(opened.data.platformProjectId,platformProjectId)
 assert.equal((await service.call('alice','list_project_sessions',{platformProjectId})).sessions.length,2)
 assert.equal((await service.call('alice','get_project_progress',{projectId})).projectId,projectId)
 const list=await service.call('alice','list_projects',{});assert.equal(list.nativeProjects,null);assert.ok(list.platformProjects.some(p=>p.id===platformProjectId))
 await service.call('alice','rename_project',{projectId:platformProjectId,name:'Renamed',requestId:'rename'})
 assert.equal(manager.state.platformProjects.alice.find(p=>p.id===platformProjectId).name,'Renamed')
 assert.equal((await service.call('alice','get_session_history',{projectId})).source,'platform')
 await assert.rejects(service.call('bob','list_project_sessions',{platformProjectId}),/PROJECT_NOT_FOUND/)
 await manager.save();const saved=JSON.parse(await readFile(join(manager.stateDir,'assistant-sessions.json'),'utf8'))
 assert.ok(saved.platformProjects.alice.some(p=>p.id===platformProjectId));assert.equal(conversations.root.alice.active,'1')
})
test('a newly created logical conversation can receive a routed task without inventing a native thread',async t=>{
 const f=await fixture(t),choice=(await f.service.call('alice','list_workspace_choices',{projectId:'1'})).items.find(c=>c.name==='repo')
 const target=await f.service.call('alice','create_project',{name:'Target',workspaceToken:choice.workspaceToken,requestId:'create'})
 const {id}=await f.begin('fix this')
 const routed=await f.service.call('alice','route_conversation_request',{projectId:target.data.projectId,sourceTaskId:id,requestId:'route'})
 assert.equal(routed.status,'queued');assert.equal(f.enqueued.length,1);assert.equal(f.jobs.get(routed.data.taskId).input.projectDispatch.threadId,null)
 await f.finish('all finished')
 assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'handed_off');assert.match(f.sent.at(-1),/排队/)
})
test('ordinary prose and legacy flow tags cannot declare waiting, failure or business completion',async t=>{
 const f=await fixture(t),{s}=await f.begin()
 await f.finish(`FAILED 已经全部完成 <wechat-task:${s.traceId}>waiting_attachment</wechat-task:${s.traceId}>`)
 const result=f.manager.state.users.alice.resultIdentity
 assert.equal(result.execution,'completed');assert.equal(result.taskOutcome,'unknown');assert.equal(f.manager.state.users.alice.waitingAttachment,undefined)
 assert.ok(!f.sent.at(-1).includes('wechat-task'))
 const literal='code <wechat-task:other> hello';assert.equal(stripTaskFlow(literal,'nonce').text,literal)
})
test('typed attachment request overrides contradictory prose and survives recovery with no text marker',async t=>{
 const f=await fixture(t),{id,s,args}=await f.begin('read missing file')
 const receipt=await f.service.call('alice','request_task_input',{...args,kind:'attachment'})
 assert.equal(receipt.status,'confirmed');assert.equal(heartbeatDue(s,Date.now()+1000000),false);assert.equal(taskProgress(s).phase,'waiting')
 assert.deepEqual(await f.service.call('alice','request_task_input',{...args,kind:'attachment'}),receipt)
 await f.finish('已经完成')
 assert.equal(f.manager.state.users.alice.recovery.execution,'waiting_attachment')
 assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'waiting_attachment')
 const nativeId=s.threadId,turnId=s.turnId
 f.manager.protocol.recoverTurn=async()=>({id:turnId,status:'completed',items:[{type:'agentMessage',text:'No marker at all'}]})
 const intake=new DurableIntake({jobs:f.jobs,manager:f.manager,reply:async()=>{}})
 await intake.recover(f.jobs.get(id),async()=>assert.fail('must not report a business completion'),{current:()=>true})
 assert.equal(f.manager.state.users.alice.waitingAttachment.threadId,nativeId)
})
test('stale task, foreign owner, cancelled generation and invalid input controls are rejected',async t=>{
 const f=await fixture(t),{s,args}=await f.begin()
 assert.equal((await f.service.call('alice','request_task_input',{...args,sourceTaskId:'old',kind:'answer'})).status,'rejected')
 assert.equal((await f.service.call('bob','request_task_input',{...args,requestId:'foreign',kind:'answer'})).status,'rejected')
 await assert.rejects(f.service.call('alice','request_task_input',{...args,requestId:'invalid',kind:'something'}),/INVALID_ARGUMENTS/)
 f.manager.lifecycle.cancel('alice')
 assert.equal((await f.service.call('alice','request_task_input',{...args,requestId:'cancelled',kind:'attachment'})).status,'rejected')
 await f.finish('stopped','interrupted');assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'cancelled')
})
test('structured task result is distinct from delivery and from the native turn result',async t=>{
 const f=await fixture(t),{args}=await f.begin()
 const receipt=await f.service.call('alice','report_task_result',{...args,outcome:'blocked'})
 assert.equal(receipt.status,'confirmed');assert.equal(receipt.data.evidence,'agent_report')
 await f.finish('Everything succeeded')
 const result=f.manager.state.users.alice.resultIdentity
 assert.equal(result.execution,'completed');assert.equal(result.taskOutcome,'blocked');assert.equal(result.outcomeEvidence,'agent_report');assert.equal(result.delivery,'accepted')
})
test('unknown terminal event never becomes success and failure supersedes a prior waiting control',async t=>{
 const f=await fixture(t),first=await f.begin()
 await f.service.call('alice','request_task_input',{...first.args,kind:'answer'});await f.finish('success','failed')
 assert.equal(f.manager.state.users.alice.resultIdentity.execution,'failed');assert.equal(first.s.waitingUser,false)
 const next=await f.begin();await f.finish('complete','new-unrecognized-status')
 assert.equal(f.manager.state.users.alice.resultIdentity.execution,'unknown');assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'unknown')
 assert.ok(!f.sent.join('').includes('✅ 本轮回答结束'));assert.equal(next.s.busy,false)
})
test('task reducer only accepts matching structured identities and terminal statuses',()=>{
 const id={taskId:'job',threadId:'thread',turnId:'turn'},control={...id,waitingFor:'attachment',outcome:'completed'}
 assert.equal(turnExecution('completed',control,id),'waiting_attachment');assert.equal(turnExecution('future',control,id),'unknown')
 assert.equal(taskOutcome('completed',control,{...id,turnId:'other'}),'unknown');assert.equal(taskOutcome('failed',control,id),'failed')
 assert.equal(taskOutcome('completed',{...id,outcome:'completed'},id),'completed');assert.equal(taskOutcome('completed',null,id),'unknown')
})
test('legacy project migration groups only exact native links, never similarly named folders',()=>{
 const state={},entries=[{id:'1',key:'a',name:'same'},{id:'2',key:'b',name:'same'},{id:'3',key:'c',name:'other'}],users={a:{nativeProjectId:'native',workspace:'/repo'},b:{workspace:'/repo'},c:{nativeProjectId:'native',workspace:'/worktree'}}
 const projects=ensurePlatformProjects(state,'owner',entries,users,'/default')
 assert.equal(projects.length,2);assert.equal(entries[0].platformProjectId,entries[2].platformProjectId);assert.notEqual(entries[0].platformProjectId,entries[1].platformProjectId)
 assert.equal(projects[0].workspaceVerified,false);assert.deepEqual(ensurePlatformProjects(state,'owner',entries,users,'/default'),projects)
})
test('platform history combines bound agents, excludes foreign-owner messages, and uses scoped stable cursors',async t=>{
 const f=await fixture(t),{service,manager,jobs}=f
 manager.state.users.alice={threadId:'claude',activeAgent:'claude',nativeSessions:{codex:{threadId:'codex'},claude:{threadId:'claude'}}}
 const a=jobs.add('alice',{text:'old codex message'},'a');jobs.bind(a,'codex')
 const b=jobs.add('alice',{text:'new claude message'},'b');jobs.bind(b,'claude')
 const privateId=jobs.add('bob',{text:'private'},'private');jobs.bind(privateId,'claude')
 manager.state.users.alice.lastReply='x'.repeat(12000);manager.state.users.alice.resultIdentity={id:'result',threadId:'claude',turnId:'turn',createdAt:new Date().toISOString()}
 const first=await service.call('alice','get_session_history',{projectId:'1'})
 assert.ok(first.messages.some(m=>m.text==='old codex message'));assert.ok(first.messages.some(m=>m.text==='new claude message'));assert.ok(!first.messages.some(m=>m.text==='private'));assert.ok(first.nextCursor)
 const second=await service.call('alice','get_session_history',{projectId:'1',cursor:first.nextCursor});assert.equal(first.messages.filter(m=>m.role==='assistant').map(m=>m.text).join('').length+second.messages.map(m=>m.text).join('').length,12000)
 await assert.rejects(service.call('bob','get_session_history',{projectId:'1',cursor:first.nextCursor}),/CREDENTIAL_INVALID/)
 manager.state.users.alice.lastReply+='changed'
 await assert.rejects(service.call('alice','get_session_history',{projectId:'1',cursor:first.nextCursor}),/HISTORY_CHANGED/)
})
test('unverified legacy native membership requires an explicit workspace credential before routing',async t=>{
 const f=await fixture(t),{manager,conversations,service}=f
 const entry=conversations.find('alice','1'),project=manager.state.platformProjects.alice.find(p=>p.id===entry.platformProjectId)
 project.workspaceVerified=false
 const choice=(await service.call('alice','list_workspace_choices',{projectId:'1'})).items[0]
 const result=await service.call('alice','request_project_workspace',{platformProjectId:project.id,workspaceToken:choice.workspaceToken,requestId:'verify'})
 assert.equal(result.status,'confirmed');assert.equal(project.workspaceVerified,true)
 await assert.rejects(service.call('bob','list_project_sessions',{platformProjectId:'missing'}),/PROJECT_NOT_FOUND/)
})
test('local project session pages are bounded and cursors cannot cross project scopes',async t=>{
 const f=await fixture(t),choice=(await f.service.call('alice','list_workspace_choices',{projectId:'1'})).items[0]
 const created=await f.service.call('alice','create_project',{name:'two sessions',workspaceToken:choice.workspaceToken,requestId:'create'})
 await f.service.call('alice','create_project_session',{platformProjectId:created.data.platformProjectId,requestId:'session'})
 const page=await f.service.call('alice','list_project_sessions',{platformProjectId:created.data.platformProjectId,limit:1})
 assert.equal(page.sessions.length,1);assert.ok(page.nextCursor)
 assert.equal((await f.service.call('alice','list_project_sessions',{platformProjectId:created.data.platformProjectId,limit:1,cursor:page.nextCursor})).sessions.length,1)
 await assert.rejects(f.service.call('alice','list_project_sessions',{cursor:page.nextCursor}),/INVALID_CURSOR/)
})
test('a structured answer wait resumes its original logical task, without classifying the answer text',async t=>{
 const f=await fixture(t),first=await f.begin('original goal'),taskId=first.s.localTask.id
 await f.service.call('alice','request_task_input',{...first.args,kind:'answer'})
 await f.finish('Which option?')
 assert.equal(f.manager.state.users.alice.recovery.execution,'waiting_user')
 assert.equal(f.manager.state.users.alice.waitingInput.task.id,taskId)
 const replyId=f.jobs.add('alice',{text:'B'},'answer')
 await f.manager.handle('alice',{text:'B',deliveryId:replyId},async()=>({status:'accepted'}))
 const s=f.manager.sessions.get('alice');assert.equal(s.localTask.id,taskId);assert.equal(s.attachmentContinuation.request,'original goal');assert.equal(f.manager.state.users.alice.waitingInput,undefined)
 await f.finish('got it')
})
test('an ended turn with an unknown business outcome cannot release a dependent task',async t=>{
 const f=await fixture(t),intake=new DurableIntake({jobs:f.jobs,manager:f.manager,reply:async()=>({status:'accepted'})})
 t.after(()=>{intake.close();for(const session of f.manager.sessions.values())f.manager.resolveWaiters(session,{status:'unknown'})})
 const source=intake.submit('alice',{text:'implement something'},'source'),dependent=intake.submit('alice',{text:'dependent',dependencies:[source]},'dependent')
 for(let i=0;i<100&&!f.manager.sessions.get('alice')?.turnReady;i++)await new Promise(r=>setTimeout(r,5))
 assert.equal(f.manager.sessions.get('alice').turnReady,true)
 await f.finish('已经全部完成')
 for(let i=0;i<100&&f.jobs.get(dependent).state!=='cancelled';i++)await new Promise(r=>setTimeout(r,5))
 assert.equal(f.jobs.get(source).outcome,'not_confirmed');assert.equal(f.jobs.get(dependent).state,'cancelled')
})
test('stopping an idle input wait journals cancellation so recovery cannot restore it',async t=>{
 const f=await fixture(t),{id,s,args}=await f.begin('original')
 await f.service.call('alice','request_task_input',{...args,kind:'answer'});await f.finish('waiting')
 await f.manager.handle('alice','停止',async()=>({status:'accepted'}))
 assert.equal(f.jobs.get(id).context.control.cancelled,true);assert.equal(f.manager.state.users.alice.waitingInput,undefined)
 f.manager.protocol.recoverTurn=async()=>({id:s.turnId,status:'completed',items:[{type:'agentMessage',text:'waiting'}]})
 const intake=new DurableIntake({jobs:f.jobs,manager:f.manager,reply:async()=>{}})
 await intake.recover(f.jobs.get(id),async()=>{}, {current:()=>true})
 assert.equal(f.manager.state.users.alice.waitingInput,undefined);assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'cancelled')
})
test('history pages preserve full user messages, including non-BMP text, without changing Mac previews',async t=>{
 const f=await fixture(t),text='中文🙂'.repeat(6000),id=f.jobs.add('alice',{text},'long-user')
 f.jobs.bind(id,'t');f.manager.state.users.alice={threadId:'t'}
 let cursor,combined='';do{const page=await f.service.call('alice','get_session_history',{projectId:'1',...(cursor?{cursor}:{})});combined+=page.messages.filter(m=>m.role==='user').map(m=>m.text).join('');cursor=page.nextCursor}while(cursor)
 assert.equal(combined,text);assert.equal(Array.from(f.jobs.companionMessages('alice','t')[0].text).length,6000)
})
test('full ingress history reads the original text rather than its display preview',async t=>{
 const f=await fixture(t),text='z'.repeat(32000)
 f.manager.state.users.alice={threadId:'t'}
 f.jobs.capture({userId:'alice',_conversationOwner:'alice',text,raw:{message_id:'long-inbound'}})
 f.jobs.db.prepare("UPDATE ingress SET chat_thread='t' WHERE owner='alice'").run()
 let cursor,combined='';do{const page=await f.service.call('alice','get_session_history',{projectId:'1',...(cursor?{cursor}:{})});combined+=page.messages.map(m=>m.text).join('');cursor=page.nextCursor}while(cursor)
 assert.equal(combined,text);assert.equal(f.jobs.companionIngress('alice','t')[0].text.length,24000)
})
test('input arriving after a structured wait stays local and then resumes the original task',async t=>{
 const f=await fixture(t),{id,s,args}=await f.begin('original goal'),original=s.localTask.id
 await f.service.call('alice','request_task_input',{...args,kind:'answer'})
 const {enqueueDuringTurn}=await import('../../src/application/tasks/native-queue.mjs')
 const answer=f.jobs.add('alice',{text:'B'},'answer')
 enqueueDuringTurn({manager:f.manager,jobs:f.jobs,log(){}},'alice',{text:'B'},answer)
 assert.equal(f.jobs.get(answer).state,'pending')
 await f.finish('Which option?');await f.manager.handle('alice',{text:'B',deliveryId:answer},async()=>({status:'accepted'}))
 assert.equal(s.localTask.id,original);assert.equal(f.manager.state.users.alice.waitingInput,undefined)
 await f.finish('answer processed')
})
test('an already queued answer consumes an exact predecessor wait and retains the original task',async t=>{
 const f=await fixture(t),{id,s,args}=await f.begin('original goal'),original=s.localTask.id
 const {enqueueDuringTurn}=await import('../../src/application/tasks/native-queue.mjs')
 const answer=f.jobs.add('alice',{text:'B'},'queued-answer');enqueueDuringTurn({manager:f.manager,jobs:f.jobs,log(){}},'alice',{text:'B'},answer)
 assert.equal(f.jobs.get(answer).state,'bound')
 await f.service.call('alice','request_task_input',{...args,kind:'answer'});await f.finish('Choose')
 await f.manager.event(s,{method:'item/started',params:{threadId:s.threadId,turnId:'queued-turn',item:{type:'userMessage',clientId:answer}}})
 assert.equal(s.localTask.id,original);assert.equal(s.attachmentContinuation.request,'original goal');assert.equal(s.waitingUser,false);assert.equal(f.manager.state.users.alice.waitingInput,undefined)
 assert.equal(f.jobs.get(answer).context.continuation.task.id,original)
 await f.service.call('alice','report_task_result',{projectId:'1',sourceTaskId:answer,turnId:s.turnId,outcome:'completed',requestId:'answer-finished'})
 await f.finish('done');assert.equal(f.manager.state.users.alice.resultIdentity.taskOutcome,'completed');assert.equal(f.manager.state.users.alice.waitingInput,undefined)
})
test('queued answer recovery uses the durable predecessor even when the start event was lost',async t=>{
 const f=await fixture(t),{id,s,args}=await f.begin('original goal'),original=s.localTask.id
 const {enqueueDuringTurn}=await import('../../src/application/tasks/native-queue.mjs')
 const answer=f.jobs.add('alice',{text:'B'},'queued-before-crash');enqueueDuringTurn({manager:f.manager,jobs:f.jobs,log(){}},'alice',{text:'B'},answer)
 await f.service.call('alice','request_task_input',{...args,kind:'answer'});await f.finish('Choose')
 f.manager.protocol.recoverTurn=async()=>({id:'recovered-answer',status:'completed',items:[{type:'agentMessage',text:'done'}]})
 const intake=new DurableIntake({jobs:f.jobs,manager:f.manager,reply:async()=>({status:'accepted'})})
 await intake.recover(f.jobs.get(answer),async()=>({status:'accepted'}),{current:()=>true})
 assert.equal(f.manager.state.users.alice.lastTask.id,original);assert.equal(f.manager.state.users.alice.waitingInput,undefined)
 assert.equal(f.jobs.get(answer).context.continuation.task.id,original)
})
test('a queued job cannot consume a different or newer input wait',()=>{
 return import('../../src/domain/tasks/queued-continuation.mjs').then(({queuedContinuation,consumeQueuedWaiting})=>{
  const wait={kind:'answer',sourceTaskId:'source',turnId:'turn',threadId:'t',task:{id:'goal'}},record={waitingInput:wait}
  assert.equal(queuedContinuation(record,{thread_id:'other',context:{predecessor:{taskId:'source',turnId:'turn'}}}),null)
  assert.equal(queuedContinuation(record,{thread_id:'t',context:{predecessor:{taskId:'wrong',turnId:'turn'}}}),null)
  assert.equal(queuedContinuation(record,{thread_id:'t',context:{}}),null)
  assert.equal(consumeQueuedWaiting(record,{...wait,turnId:'old'}),false);assert.equal(record.waitingInput,wait)
 })
})
test('empty thread is runtime-only, and first submission durably binds its identity before RPC',async t=>{
 const f=await fixture(t),s=await f.manager.connect('alice',async()=>{})
 assert.equal(s.provisionalThread,true);assert.equal(f.manager.state.users.alice.threadId,undefined)
 let bound=false;const request=s.rpc.request.bind(s.rpc)
 s.rpc.request=async(method,params)=>{if(method==='turn/start'){
  const persisted=JSON.parse(await readFile(join(f.manager.stateDir,'assistant-sessions.json'),'utf8')).users.alice
  assert.equal(persisted.threadId,s.threadId);assert.equal(persisted.nativeSessionState,'submission_pending');bound=true
 }return request(method,params)}
 const id=f.jobs.add('alice',{text:'first'},'first')
 await f.manager.handle('alice',{text:'first',deliveryId:id},async()=>({status:'accepted'}))
 assert.equal(bound,true);assert.equal(f.manager.state.users.alice.nativeSessionState,'submitted');await f.finish('done')
})
test('a failed pre-submission checkpoint never calls the model and cannot promote an empty identity silently',async t=>{
 const f=await fixture(t),s=await f.manager.connect('alice',async()=>{});let started=false
 const request=s.rpc.request.bind(s.rpc);s.rpc.request=async(method,params)=>{if(method==='turn/start')started=true;return request(method,params)}
 f.manager.save=async()=>{throw Error('disk unavailable')}
 await assert.rejects(f.manager.send(s,{text:'first'}),/disk unavailable/)
 assert.equal(started,false);assert.equal(f.manager.state.users.alice.nativeSessionState,'submission_pending')
})
test('recovering an older answer cannot erase a newer wait for the same logical goal',async t=>{
 const f=await fixture(t),{id,s}=await f.begin('same goal')
 await f.finish('older result')
 const newer={kind:'answer',task:s.localTask,request:'newer question',threadId:s.threadId,sourceTaskId:'newer-task',turnId:'newer-turn'}
 f.manager.state.users.alice.waitingInput=newer
 f.manager.protocol.recoverTurn=async()=>({id:s.turnId,status:'completed',items:[{type:'agentMessage',text:'older result'}]})
 const intake=new DurableIntake({jobs:f.jobs,manager:f.manager,reply:async()=>{}})
 await intake.recover(f.jobs.get(id),async()=>{}, {current:()=>true})
 assert.equal(f.manager.state.users.alice.waitingInput,newer)
})
