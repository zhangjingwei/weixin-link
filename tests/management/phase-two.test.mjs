import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rename,symlink,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {ScheduleService} from '../../src/application/schedules/schedule-service.mjs'
import {UpdateNotifier} from '../../src/application/notifications/update-notifier.mjs'
import {recordTaskResult,archiveTaskResult} from '../../src/application/tasks/task-result.mjs'
import {validateManagementCall} from '../../src/application/management/tools.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'zlm-phase2-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'workspace/knowledge'),{recursive:true})
 const manager=new SessionManager({stateDir:join(dir,'state'),cwd:join(dir,'workspace'),owners:['alice','bob'],providerEnv:{},rpcFactory:()=>{throw Error('unexpected connection')}})
 manager.state.users={alice:{threadId:'a'},bob:{threadId:'b'}};manager.save=async()=>{}
 const backend={capabilities:{catalog:false,history:true},confirmSession:async s=>({id:s.threadId}),withConnection:async(owner,recipient,work)=>work({}),listTurns:async()=>({data:[]})}
 const conversations=new TextConversations(manager,['alice','bob'],()=>({}),backend)
 const jobs=new DurableJobs(join(dir,'jobs.db'));manager.submissions=jobs;t.after(()=>jobs.close())
 let scheduleState=null
 const schedules=await new ScheduleService({owners:['alice','bob'],stateStore:{load:async()=>scheduleState,save:async value=>{scheduleState=structuredClone(value)}},send:async()=>({status:'accepted'}),submitTask:async()=>({status:'accepted',submissionId:'submitted-task'}),now:()=>Date.parse('2026-11-23T20:00:00Z')}).init();t.after(()=>schedules.close())
 const deliveries=[],notices=[],wakes=[]
 manager.wakeRecovery=key=>wakes.push(key)
 const service=new ManagementService({manager,conversations,schedules,deliver:async(key,value)=>{deliveries.push({key,value});return {status:'accepted'}},notice:async(...args)=>notices.push(args),timeZone:'America/Los_Angeles'})
 t.after(()=>service.close())
 return {dir,manager,conversations,jobs,schedules,service,backend,deliveries,wakes,notices}
}
test('new projects use bound directory credentials, never switch or connect, and deduplicate across restart',async t=>{
 const f=await fixture(t),{service,manager,conversations}=f
 const choices=await service.call('alice','list_workspace_choices',{projectId:'1'})
 const choice=choices.items.find(c=>c.name==='knowledge');assert(choice)
 const args={name:'知识库',workspaceToken:choice.workspaceToken,requestId:'project-new'}
 const created=await service.call('alice','create_project',args)
 assert.equal(created.status,'confirmed');assert.equal(created.data.switched,false);assert.equal(created.data.connected,false)
 assert.equal(conversations.root.alice.active,'1');assert.equal(manager.sessions.size,0)
 assert.equal(conversations.find('alice',created.data.projectId).name,'知识库')
 const size=conversations.root.alice.entries.length
 const restored=new ManagementService({manager,conversations});t.after(()=>restored.close())
 assert.equal((await restored.call('alice','create_project',args)).operationId,created.operationId);assert.equal(conversations.root.alice.entries.length,size)
 await assert.rejects(service.call('alice','create_project',{...args,name:'other'}),/CONFLICT/)
 const renamed=await service.call('alice','rename_project',{projectId:created.data.projectId,name:'文档库',requestId:'rename'})
 assert.equal(renamed.status,'confirmed');assert.equal(conversations.root.alice.active,'1')
})
test('directory replacement, foreign credentials and arbitrary path arguments cannot create projects',async t=>{
 const {service,dir,conversations}=await fixture(t)
 const choices=await service.call('alice','list_workspace_choices',{projectId:'1'}),token=choices.items.find(c=>c.name==='knowledge').workspaceToken
 await rename(join(dir,'workspace/knowledge'),join(dir,'moved'));await symlink(join(dir,'moved'),join(dir,'workspace/knowledge'),'dir')
 const result=await service.call('alice','create_project',{name:'wrong',workspaceToken:token,requestId:'one'})
 assert.equal(result.status,'rejected');assert.equal(conversations.root.alice.entries.length,1)
 const foreign=await service.call('bob','create_project',{name:'wrong',workspaceToken:token,requestId:'two'});assert.equal(foreign.status,'rejected')
 await assert.rejects(service.call('alice','create_project',{name:'wrong',workspaceToken:token,requestId:'three',path:'/etc'}),/INVALID_ARGUMENTS/)
})
test('daily targeting uses stable identity even after it is renamed',async t=>{
 const {service,conversations}=await fixture(t);conversations.root.alice.entries[0].name='聊天天地'
 const found=await service.call('alice','resolve_target',{query:'日常'})
 assert.equal(found.resolution,'unique');assert.equal(found.candidates[0].daily,true)
})
test('history search spans text chunks and explicitly reports a 50-turn search boundary',async t=>{
 const {service,backend}=await fixture(t)
 const text='x'.repeat(9998)+'needle'+'x'.repeat(6000)
 backend.listTurns=async()=>({data:[{id:'turn',startedAt:123,items:[{type:'agentMessage',text}]}]})
 const first=await service.call('alice','search_session_history',{projectId:'1',query:'needle'})
 assert.equal(first.matches.length,0);assert(first.nextCursor);assert.equal(first.complete,false)
 const second=await service.call('alice','search_session_history',{projectId:'1',query:'needle',cursor:first.nextCursor})
 assert.equal(second.matches[0].offset,9998);assert.equal(second.scannedTurns,1);assert.equal(second.complete,true)
 backend.listTurns=async(rpc,threadId,{cursor}={})=>{const index=Number(cursor??0);return {data:[{id:'t'+index,items:[{type:'agentMessage',text:'no match'}]}],nextCursor:String(index+1)}}
 let cursor,page
 do{page=await service.call('alice','search_session_history',{projectId:'1',query:'absent',...(cursor?{cursor}:{})});cursor=page.nextCursor}while(cursor)
 assert.equal(page.scannedTurns,50);assert.equal(page.limited,true);assert.equal(page.complete,false)
})
function resultFixture(manager){
 const record=manager.state.users.alice;record.lastReply='原结果 [文件](/private/result.md)';record.lastOutput={kind:'bundle',id:'packet-original',text:'原结果',attachments:[{id:'file',fileName:'result.md',path:'/private/snapshot',bytes:5,sha256:'hash',kind:'file'}],errors:[],textParts:[]}
 recordTaskResult(record,{taskId:'original-task',threadId:'a',turnId:'completed-turn',execution:'completed',delivery:'accepted'})
 return record
}
test('result query is read-only; redelivery pins original snapshot when a newer result arrives',async t=>{
 const {service,manager,deliveries}=await fixture(t),record=resultFixture(manager)
 manager.outputStoreFor=()=>({replay:p=>structuredClone(p),bytes:async()=>Buffer.from('bytes')})
 const read=await service.call('alice','get_task_result',{projectId:'1'});assert.equal(deliveries.length,0);assert.equal(read.taskId,'original-task');assert.equal(read.attachments[0].availability,'not_checked');assert(!read.text.includes('/private/'))
 const args={projectId:'1',resultToken:read.resultToken,requestId:'redeliver-one'}
 const requested=await service.call('alice','request_result_redelivery',args);assert.equal(requested.status,'pending');assert.equal(deliveries.length,0)
 record.lastReply='新结果';record.lastOutput=undefined;recordTaskResult(record,{taskId:'next-task',threadId:'a',turnId:'next-turn',execution:'completed',delivery:'accepted'})
 const op=service.operations.find(o=>o.id===requested.operationId);await service.execute(op)
 assert.equal(op.status,'accepted');assert.equal(deliveries[0].value.text,'原结果')
 assert.equal((await service.call('alice','request_result_redelivery',args)).operationId,requested.operationId);assert.equal(deliveries.length,1)
})
test('missing or expired snapshots stop redelivery before sending any text',async t=>{
 const {service,manager,deliveries}=await fixture(t);resultFixture(manager)
 manager.outputStoreFor=()=>({replay:p=>structuredClone(p),bytes:async()=>{throw Error('ARTIFACT_EXPIRED')}})
 const read=await service.call('alice','get_task_result',{projectId:'1'})
 const requested=await service.call('alice','request_result_redelivery',{projectId:'1',resultToken:read.resultToken,requestId:'missing'})
 await service.execute(service.operations.find(o=>o.id===requested.operationId));assert.equal(deliveries.length,0);assert.equal(service.operations.at(-1).status,'not_executed')
 const foreign=await service.call('bob','request_result_redelivery',{projectId:'1',resultToken:read.resultToken,requestId:'foreign'});assert.equal(foreign.status,'rejected')
})
test('result text paging loses no Unicode and rejects changed results',async t=>{
 const {service,manager}=await fixture(t),record=resultFixture(manager);record.lastReply='中文🙂'.repeat(8000)
 let cursor,text=''
 do{const page=await service.call('alice','get_task_result',{projectId:'1',...(cursor?{cursor}:{})});text+=page.text;cursor=page.nextCursor}while(cursor)
 assert.equal(text,record.lastReply)
 const page=await service.call('alice','get_task_result',{projectId:'1'});record.lastReply='changed'
 await assert.rejects(service.call('alice','get_task_result',{projectId:'1',cursor:page.nextCursor}),/RESULT_CHANGED/)
})
test('targeted reconciliation changes only one uncertain job and does not reexecute',async t=>{
 const {service,manager,jobs,wakes}=await fixture(t)
 const ids=[jobs.add('alice','one'),jobs.add('alice','two'),jobs.add('bob','foreign')]
 for(const id of ids){jobs.bind(id,id===ids[2]?'b':'a');jobs.submitted(id,'turn');jobs.mark(id,'uncertain')}
 const listed=await service.call('alice','list_project_tasks',{projectId:'1'});assert.equal(listed.items.length,2);assert(!JSON.stringify(listed).includes('foreign'))
 const request=await service.call('alice','request_task_reconciliation',{projectId:'1',taskId:ids[0],requestId:'recover-one'})
 assert.equal(request.status,'pending');assert.equal(jobs.get(ids[0]).state,'uncertain')
 await service.execute(service.operations.find(o=>o.id===request.operationId))
 assert.equal(jobs.get(ids[0]).state,'submitted');assert.equal(jobs.get(ids[1]).state,'uncertain');assert.equal(jobs.get(ids[2]).state,'uncertain');assert.deepEqual(wakes,['alice'])
 assert.equal((await service.call('alice','get_management_operation',{operationId:request.operationId})).data.reexecuted,false)
 const foreign=await service.call('alice','request_task_reconciliation',{projectId:'1',taskId:ids[2],requestId:'foreign'});assert.equal(foreign.status,'rejected')
})
test('reconciliation refuses to clobber a task that starts during bookkeeping',async t=>{
 const {service,manager,jobs,wakes}=await fixture(t),id=jobs.add('alice','old');jobs.bind(id,'a');jobs.submitted(id,'old-turn');jobs.mark(id,'uncertain')
 const response=await service.call('alice','request_task_reconciliation',{projectId:'1',taskId:id,requestId:'recover'})
 let writes=0;manager.save=async()=>{if(++writes===1)manager.sessions.set('alice',{busy:true,traceId:'new'})}
 await service.execute(service.operations.find(o=>o.id===response.operationId));assert.equal(jobs.get(id).state,'uncertain');assert.equal(wakes.length,0)
})
test('schedule creation uses project identity, survives duplicate retries, and cancellation does not stop submitted work',async t=>{
 const {service,schedules}=await fixture(t),args={projectId:'1',kind:'task',text:'整理项目',at:'2026-11-23T21:00:00Z',requestId:'schedule-one'}
 const created=await service.call('alice','create_schedule',args);assert.equal(created.status,'confirmed');assert.equal(created.data.projectId,'1');assert.equal(created.data.executed,false)
 const again=await service.call('alice','create_schedule',args);assert.equal(again.data.id,created.data.id)
 const listed=await service.call('alice','list_schedules',{});assert.equal(listed.items.length,1);assert.equal(listed.items[0].projectId,'1');assert(!JSON.stringify(listed).includes('conversationKey'))
 const job=schedules.state.jobs[created.data.id];job.status='accepted';job.submissionId='already-submitted'
 const cancelled=await service.call('alice','cancel_schedule',{scheduleId:job.id,requestId:'cancel-one'});assert.equal(cancelled.data.runningTaskStopped,false);assert.equal(cancelled.data.taskMayStillBeRunning,true);assert.equal(cancelled.data.futureTriggersCancelled,false)
 const foreign=await service.call('bob','cancel_schedule',{scheduleId:job.id,requestId:'foreign'});assert.equal(foreign.status,'rejected')
})
test('schedule store atomically deduplicates concurrent creates and compares nested request content',async t=>{
 const {schedules}=await fixture(t),request={kind:'task',text:'one',repeat:{frequency:'daily',time:'09:00',timeZone:'America/Los_Angeles'}}
 const [a,b]=await Promise.all([schedules.create('alice',request,'alice',{requestId:'one'}),schedules.create('alice',request,'alice',{requestId:'one'})]);assert.equal(a.id,b.id)
 await assert.rejects(schedules.create('alice',{...request,text:'different'},'alice',{requestId:'one'}),/CONFLICT/)
 assert.throws(()=>validateManagementCall('create_schedule',{projectId:'1',kind:'task',text:'one',repeat:{...request.repeat,owner:'bob'},requestId:'two'}),/INVALID_ARGUMENTS/)
})
test('explicit skip keeps a newer notice eligible and account state isolated',async t=>{
 const {service}=await fixture(t),states=new Map([['alice',{version:1,tag:'v2.0.0',status:'accepted'}]])
 const notifier=new UpdateNotifier({owners:['alice','bob'],stateStore:{read:async owner=>states.get(owner)??null,write:async(owner,value)=>states.set(owner,value)},readInstalled:async()=>null,fetchLatest:async()=>null,send:async()=>({status:'accepted'})})
 service.updates={query:async()=>({latest:{tag:'v1.9.0'}}),skipVersion:(owner,version)=>notifier.skip(owner,'zh',version)}
 const checked=await service.call('alice','check_updates',{})
 const skipped=await service.call('alice','skip_update',{updateToken:checked.updateToken,requestId:'skip'});assert.equal(skipped.data.version,'v1.9.0');assert.equal(states.get('alice').tag,'v2.0.0');assert.equal(states.get('alice').status,'accepted');assert.deepEqual(states.get('alice').skippedTags,['v1.9.0'])
 const foreign=await service.call('bob','skip_update',{updateToken:checked.updateToken,requestId:'foreign'});assert.equal(foreign.status,'rejected');assert.equal(states.has('bob'),false)
})

test('real retained attachment integrity is checked before redelivery',async t=>{
 const {service,manager,dir,deliveries}=await fixture(t),source=join(dir,'workspace/result.md')
 await writeFile(source,'original bytes')
 const store=manager.outputStoreFor('alice'),packet=await store.package('alice','完成 [附件]('+source+')')
 const record=manager.state.users.alice;record.lastReply=packet.text;record.lastOutput=packet
 recordTaskResult(record,{taskId:'artifact-task',threadId:'a',turnId:'artifact-turn',execution:'completed',delivery:'accepted'})
 const read=await service.call('alice','get_task_result',{projectId:'1'})
 const requested=await service.call('alice','request_result_redelivery',{projectId:'1',resultToken:read.resultToken,requestId:'tampered'})
 await writeFile(packet.attachments[0].path,'tampered bytes')
 await service.execute(service.operations.find(o=>o.id===requested.operationId))
 assert.equal(deliveries.length,0);assert.equal(service.operations.at(-1).detail,'MANAGEMENT_ARTIFACT_UNAVAILABLE')
})
test('historical completed task results are queried without resuming or resending files',async t=>{
 const {service,manager,jobs}=await fixture(t),id=jobs.add('alice','older request');jobs.bind(id,'older-authorized-thread');jobs.submitted(id,'older-turn');jobs.mark(id,'done')
 manager.protocol.recoverTurn=async(rpc,request)=>{assert.equal(request.threadId,'older-authorized-thread');return {id:'older-turn',status:'completed',items:[{type:'agentMessage',text:'historical result'}]}}
 const result=await service.call('alice','get_task_result',{projectId:'1',taskId:id})
 assert.equal(result.text,'historical result');assert.equal(result.redeliveryAvailable,false);assert.equal(result.resultToken,null);assert.equal(manager.sessions.size,0)
})
test('invalid calendar dates are rejected rather than silently scheduled in another month',async t=>{
 const {service,schedules}=await fixture(t)
 const response=await service.call('alice','create_schedule',{projectId:'1',kind:'reminder',text:'invalid date',at:'2026-11-31T21:00:00Z',requestId:'invalid-date'})
 assert.equal(response.status,'rejected');assert.equal(Object.keys(schedules.state.jobs).length,0)
})
test('schedule deduplication survives a real state-store reload',async t=>{
 const {dir}=await fixture(t)
 const {createScheduleStateStore}=await import('../../src/infrastructure/storage/schedule-state.mjs')
 const stateDir=join(dir,'schedule-state'),store=createScheduleStateStore(stateDir),base={owners:['alice'],stateStore:store,now:()=>Date.parse('2026-11-23T20:00:00Z')}
 const first=await new ScheduleService(base).init(),request={kind:'task',text:'once',at:'2026-11-23T21:00:00Z'}
 const created=await first.create('alice',request,'project-key',{requestId:'persistent',timeZone:'America/Los_Angeles'});first.close()
 const second=await new ScheduleService(base).init();t.after(()=>second.close())
 const repeated=await second.create('alice',request,'project-key',{requestId:'persistent',timeZone:'America/Los_Angeles'})
 assert.equal(repeated.id,created.id);assert.equal(second.list('alice',{}).items.length,1);assert.equal(repeated.timeZone,'America/Los_Angeles')
})

test('retained old result metadata can redeliver its own snapshot after another result completes',async t=>{
 const {service,manager,deliveries}=await fixture(t),record=resultFixture(manager)
 manager.outputStoreFor=()=>({replay:p=>structuredClone(p),bytes:async()=>Buffer.from('bytes')})
 const original=await service.call('alice','get_task_result',{projectId:'1'})
 archiveTaskResult(record);record.lastReply='new';record.lastOutput=undefined
 recordTaskResult(record,{taskId:'new-task',threadId:'a',turnId:'new-turn',execution:'completed',delivery:'accepted'})
 const old=await service.call('alice','get_task_result',{projectId:'1',taskId:'original-task'});assert.equal(old.redeliveryAvailable,true)
 const pending=await service.call('alice','request_result_redelivery',{projectId:'1',resultToken:original.resultToken,requestId:'old-retained'})
 await service.execute(service.operations.find(op=>op.id===pending.operationId));assert.equal(deliveries[0].value.text,'原结果')
})
test('historical attachment-waiting turns remain waiting rather than claiming the request completed',async t=>{
 const {service,manager,jobs}=await fixture(t),id=jobs.add('alice','needs file');jobs.bind(id,'a');jobs.submitted(id,'waiting-turn');jobs.mark(id,'done');jobs.context(id,{flowNonce:'known-nonce'})
 manager.protocol.recoverTurn=async()=>({id:'waiting-turn',status:'completed',items:[{type:'agentMessage',text:'等待材料。<wechat-task:known-nonce>waiting_attachment</wechat-task:known-nonce>'}]})
 const result=await service.call('alice','get_task_result',{projectId:'1',taskId:id});assert.equal(result.execution,'waiting_attachment');assert(!result.text.includes('wechat-task:'))
})

test('extended writes prune expired receipts, preserve uncertain work and isolate owner quotas',async t=>{
 const {service,manager}=await fixture(t),now=service.now()
 const old=Array.from({length:10000},(_,i)=>({id:'old-'+i,owner:'alice',status:'confirmed',createdAt:now-8*86400000}))
 service.operations.push(...old,{id:'uncertain',owner:'alice',status:'unknown',createdAt:now-8*86400000})
 const created=await service.call('alice','rename_project',{projectId:'1',name:'renamed',requestId:'pruned'})
 assert.equal(created.status,'confirmed');assert.equal(service.operations.length,2);assert(service.operations.some(op=>op.id==='uncertain'))
 service.operations.splice(0,service.operations.length,...Array.from({length:10000},(_,i)=>({id:'full-'+i,owner:'alice',status:'confirmed',createdAt:now})))
 await assert.rejects(service.call('alice','rename_project',{projectId:'1',name:'over quota',requestId:'full'}),/MANAGEMENT_OPERATION_LIMIT/)
 const other=await service.call('bob','rename_project',{projectId:'1',name:'independent',requestId:'other'})
 assert.equal(other.status,'confirmed')
 // Legacy writes use exactly the same cleanup and per-owner quota.
 await assert.rejects(service.call('alice','request_project_switch',{projectId:'1',requestId:'legacy-full'}),/MANAGEMENT_OPERATION_LIMIT/)
 for(const op of service.operations)if(op.owner==='alice')op.createdAt=now-8*86400000
 const switched=await service.call('alice','request_project_switch',{projectId:'1',requestId:'legacy-pruned'})
 assert.equal(switched.status,'pending');assert.equal(service.operations.length,2)
 assert.equal(manager.state.managementOperations,service.operations)
})

test('unexecuted redelivery clears private payload before persistence and retains its deduplication receipt',async t=>{
 const {service,manager}=await fixture(t);resultFixture(manager)
 manager.outputStoreFor=()=>({replay:p=>structuredClone(p),bytes:async()=>{throw Error('ARTIFACT_EXPIRED')}})
 const read=await service.call('alice','get_task_result',{projectId:'1'}),args={projectId:'1',resultToken:read.resultToken,requestId:'expired-payload'}
 const requested=await service.call('alice','request_result_redelivery',args),op=service.operations.find(op=>op.id===requested.operationId)
 let persisted;manager.save=async()=>{persisted=structuredClone(service.operations)}
 await service.execute(op)
 assert.equal(op.status,'not_executed');assert.equal(op.detail,'MANAGEMENT_ARTIFACT_UNAVAILABLE')
 for(const key of ['snapshot','packet','resultToken']){assert.equal(Object.hasOwn(op,key),false);assert.equal(Object.hasOwn(persisted.at(-1),key),false)}
 const duplicate=await service.call('alice','request_result_redelivery',args)
 assert.equal(duplicate.operationId,op.id);assert.equal(duplicate.status,'not_executed')
})

test('receipt expiry clears redelivery payload without sending',async t=>{
 const {service,manager,deliveries}=await fixture(t);resultFixture(manager)
 manager.outputStoreFor=()=>({replay:p=>structuredClone(p)})
 t.mock.timers.enable({apis:['setTimeout']})
 const read=await service.call('alice','get_task_result',{projectId:'1'})
 const requested=await service.call('alice','request_result_redelivery',{projectId:'1',resultToken:read.resultToken,requestId:'no-receipt'})
 const op=service.operations.find(op=>op.id===requested.operationId)
 let persisted;manager.save=async()=>{persisted=structuredClone(service.operations)}
 t.mock.timers.tick(300000)
 assert.equal(op.status,'not_executed');assert.equal(op.detail,'MANAGEMENT_RECEIPT_EXPIRED');assert.equal(deliveries.length,0)
 for(const key of ['snapshot','packet','resultToken'])assert.equal(Object.hasOwn(persisted.at(-1),key),false)
})

test('restart removes pending and previously unexecuted payloads but keeps unknown delivery evidence',async t=>{
 const {manager,conversations}=await fixture(t),now=Date.now()
 manager.state.managementOperations=['pending','executing','not_executed'].map((status,i)=>({id:String(i),owner:'alice',status,createdAt:now,snapshot:{packet:'private'},packet:'private',resultToken:'credential'}))
 manager.state.managementOperations.push({id:'old',owner:'alice',status:'confirmed',createdAt:now-8*86400000})
 const restored=new ManagementService({manager,conversations});t.after(()=>restored.close())
 assert.equal(restored.operations.length,3)
 for(const op of restored.operations){
  if(op.id==='1'){assert.equal(op.status,'unknown');assert.equal(op.packet,'private');assert(op.snapshot)}
  else{assert.equal(op.status,'not_executed');for(const key of ['snapshot','packet','resultToken'])assert.equal(Object.hasOwn(op,key),false)}
 }
 await mkdir(manager.stateDir,{recursive:true})
 await SessionManager.prototype.save.call(manager)
 const persisted=JSON.parse(await readFile(join(manager.stateDir,'assistant-sessions.json'),'utf8')).managementOperations
 assert.equal(Object.hasOwn(persisted[0],'snapshot'),false);assert.equal(persisted[1].packet,'private')
})
