import {entryRequestId} from '../../src/domain/messages/message-identity.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EntryRouting} from '../../src/application/intake/entry-routing.mjs'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'

async function fixture(t,decision){
 const dir=await mkdtemp(join(tmpdir(),'entry-route-')),jobs=new DurableJobs(join(dir,'inbox.sqlite'));t.after(()=>{jobs.close();return rm(dir,{recursive:true,force:true})})
 const entries=[{id:'1',key:'alice',name:'Current'},{id:'2',key:'project',name:'Project'}],root={alice:{active:'1',entries}},token={current:()=>true},sent=[]
 const manager={owners:new Set(['alice','project']),state:{users:{alice:{threadId:'a'},project:{threadId:'p'}}},sessions:new Map([['alice',{busy:true,state:'running',traceId:'trace',turnId:'turn',taskId:'job'}]]),questions:new Map(),submissions:jobs,workspaceFor:()=>dir,save:async()=>{},protocol:{},lifecycle:{capture:()=>token}}
 const conversations={root,realOwners:new Set(['alice']),ensure:o=>root[o],entry:key=>{const e=entries.find(e=>e.key===key);return e?{...e,owner:'alice'}:null}}
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>jobs.add(...args)});t.after(()=>service.close())
 let count=0
 const router=new EntryRouting({manager,conversations,jobs,service,classify:async()=>{count++;return decision},deliver:async(_,text)=>{sent.push(text);return {status:'accepted'}}});t.after(()=>router.close())
 const message={userId:'alice',_conversationOwner:'alice',text:'User original request',raw:{message_id:'one'}};message._ingressId=jobs.capture(message)
 return {router,manager,service,jobs,root,entries,token,sent,message,count:()=>count}
}
test('busy project does not block cross-project dispatch; replay cannot insert a second job',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',question:null})
 assert.equal(await f.router.process(f.message,f.token),true)
 assert.equal(f.jobs.pending()[0].owner,'project');assert.equal(f.jobs.pending()[0].input.text,f.message.text)
 assert.equal(f.manager.sessions.get('alice').busy,true)
 await f.router.process(f.message,f.token);assert.equal(f.jobs.pending().length,1);assert.equal(f.count(),1)
})
test('current project tasks use its existing queue while independent queries bypass it',async t=>{
 const f=await fixture(t,{action:'task',projectId:'1',question:null});await f.router.process(f.message,f.token)
 assert.equal(f.jobs.pending()[0].owner,'alice')
 const q=await fixture(t,{action:'status',projectId:'1',question:null});await q.router.process(q.message,q.token)
 assert.equal(q.jobs.pending().length,0);assert.match(q.sent[0],/进行中：当前任务/)
})
test('foreign and invalid decisions fall back without dispatch; ambiguity only asks a question',async t=>{
 const f=await fixture(t,{action:'task',projectId:'foreign',question:null});assert.equal(await f.router.process(f.message,f.token),false);assert.equal(f.jobs.pending().length,0)
 const q=await fixture(t,{action:'clarify',projectId:null,question:'Which project?'});await q.router.process(q.message,q.token);assert.equal(q.sent[0],'Which project?');assert.equal(q.jobs.pending().length,0)
})
test('supplements bind the original task snapshot; stale tasks never turn into new work',async t=>{
 const f=await fixture(t,{action:'supplement',projectId:'1',question:null});let received
 f.manager.steer=async(_,text,reply,token,expected)=>{received=expected;return {status:'accepted'}}
 await f.router.process(f.message,f.token);assert.deepEqual(received,{traceId:'trace',turnId:'turn',requestId:entryRequestId(f.message._ingressId)});assert.equal(f.jobs.pending().length,0)
 const q=await fixture(t,{action:'supplement',projectId:'1',question:null});q.router.classify=async()=>{q.manager.sessions.get('alice').turnId='new-turn';return {action:'supplement',projectId:'1',question:null}}
 await q.router.process(q.message,q.token);assert.equal(q.jobs.pending().length,0);assert.match(q.sent[0],/未确认执行/)
})
test('cancellation during classification cannot enqueue a task',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',question:null});let current=true
 f.router.classify=async()=>{current=false;return {action:'task',projectId:'2',question:null}}
 await f.router.process(f.message,{current:()=>current});assert.equal(f.jobs.pending().length,0)
})
test('uncertain notification is not sent again on recovery',async t=>{
 const f=await fixture(t,{action:'status',projectId:'1',question:null});let sends=0;f.router.deliver=async()=>{sends++;throw Error('unknown delivery')}
 await assert.rejects(f.router.process(f.message,f.token));await f.router.process(f.message,f.token);assert.equal(sends,1)
})
test('clarification answers retain the original request and do not execute the answer as a new task',async t=>{
 const f=await fixture(t,{action:'clarify',projectId:null,question:'Which project?'})
 await f.router.process(f.message,f.token)
 const answer={...f.message,text:'Project',raw:{message_id:'answer'}};answer._ingressId=f.jobs.capture(answer)
 f.router.classify=async input=>{assert.equal(input.pendingClarification.text,f.message.text);return {action:'task',projectId:'2',question:null,useClarification:true}}
 await f.router.process(answer,f.token)
 assert.match(f.jobs.pending()[0].input.text,/User original request/);assert.match(f.jobs.pending()[0].input.text,/Project/);assert.equal(f.root.alice.entryClarification,undefined)
})
test('the original durable pump starts another project while the entry project remains busy',async t=>{
 const {DurableIntake}=await import('../../src/application/tasks/durable-intake.mjs')
 const f=await fixture(t,{action:'task',projectId:'2',question:null});let resolve,started=false
 const gate=new Promise(done=>{resolve=done})
 f.manager.ask=async owner=>{assert.equal(owner,'project');started=true;await gate}
 const durable=new DurableIntake({manager:f.manager,jobs:f.jobs,conversations:f.service.conversations,reply:async()=>{}});t.after(()=>{resolve();durable.close()})
 f.service.enqueueTask=(...args)=>durable.submit(...args)
 await f.router.process(f.message,f.token)
 assert.equal(started,true);assert.equal(f.manager.sessions.get('alice').busy,true);resolve()
})
test('history queries never deliver historical attachment links',async t=>{
 const f=await fixture(t,{action:'history',projectId:'1',question:null})
 f.service.call=async()=>({messages:[{role:'assistant',text:'[private report](/private/file.md)'}],nextCursor:'older'})
 await f.router.process(f.message,f.token);assert(!f.sent[0].includes('/private/file.md'));assert.match(f.sent[0],/尚未读取完整历史/)
})
test('original entry tasks retain management rights without permitting nested project dispatches',async t=>{
 const f=await fixture(t,{action:'task',projectId:'1',question:null});await f.router.process(f.message,f.token)
 const job=f.jobs.pending()[0];assert.equal(job.input.projectDispatch.entryOrigin,true)
 f.manager.sessions.get('alice').taskId=job.id
 f.service.maintenance={restart:async()=>({status:'scheduled'})}
 const result=await f.service.call('alice','request_service_restart',{requestId:'maintenance'})
 assert.equal(result.status,'pending')
})
test('a crash after enqueue reuses the persisted operation and queue identity',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',question:null});let snapshot,saves=0
 f.manager.save=async()=>{saves++;if(saves===8)throw Error('crash before notice');snapshot=structuredClone({state:f.manager.state,root:f.root})}
 await assert.rejects(f.router.process(f.message,f.token));assert.equal(f.jobs.pending().length,1)
 f.manager.state=snapshot.state;Object.assign(f.root,snapshot.root);f.manager.save=async()=>{}
 const restored=new ManagementService({manager:f.manager,conversations:f.service.conversations,enqueueTask:(...args)=>f.jobs.add(...args)});t.after(()=>restored.close());f.router.service=restored
 await f.router.process(f.message,f.token);assert.equal(f.jobs.pending().length,1);assert.equal(f.count(),1)
})

test('successful task dispatch persists its title without sending a repetitive notification',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',question:null,title:'修复搜索功能'})
 await f.router.process(f.message,f.token)
 const job=f.jobs.pending()[0]
 assert.equal(job.input.projectDispatch.title,'修复搜索功能');assert.deepEqual(f.sent,[]);assert.equal(f.root.alice.entryRoutes[f.message._ingressId].status,'done')
})

test('clarification retains original material identity and prepared attachments',async t=>{
 const f=await fixture(t,{action:'clarify',projectId:null,question:'Which project?'})
 await f.router.process(f.message,f.token,{text:'file metadata',attachments:[{path:'/private/example.pdf',name:'example.pdf'}]})
 let handoff;f.router.prepareHandoff=async args=>{handoff=args;return args.input}
 const answer={...f.message,text:'Project',raw:{message_id:'review-answer'}};answer._ingressId=f.jobs.capture(answer)
 f.router.classify=async()=>({action:'task',projectId:'2',useClarification:true,useAttachments:true})
 await f.router.process(answer,f.token)
 assert.equal(f.jobs.pending().length,1)
 assert.equal(f.jobs.pending()[0].input.attachments[0].name,'example.pdf')
 assert.equal(handoff.sourceKey,'alice');assert.equal(handoff.ingressId,f.message._ingressId)
})
test('multi-project clarification validates original task spans and retains dependencies',async t=>{
 const f=await fixture(t,{action:'clarify',projectId:null,question:'Which projects?'})
 f.message.text='Current check search, Project update page'
 await f.router.process(f.message,f.token)
 const answer={...f.message,text:'Current and Project',raw:{message_id:'review-batch-answer'}};answer._ingressId=f.jobs.capture(answer)
 f.router.classify=async()=>({action:'batch',useClarification:true,steps:[{action:'task',projectId:'1',text:'Current check search',dependsOn:[]},{action:'task',projectId:'2',text:'Project update page',dependsOn:[0]}]})
 assert.equal(await f.router.process(answer,f.token),true)
 const jobs=f.jobs.pending();assert.equal(jobs.length,2);assert.deepEqual(jobs[1].input.dependencies,[jobs[0].id])
})
test('cancel-all excludes jobs added during classification',async t=>{
 const f=await fixture(t,{action:'cancel_all',projectId:'2'})
 const old=f.jobs.add('project',{text:'old'},'old');let fresh,selected
 f.router.classify=async()=>{fresh=f.jobs.add('project',{text:'new after request'},'fresh');return {action:'cancel_all',projectId:'2'}}
 f.service.call=async(caller,name,args)=>{selected=args.taskIds;return {status:'confirmed',data:{cancelled:args.taskIds.length}}}
 await f.router.process(f.message,f.token)
 assert.deepEqual(new Set(selected),new Set([old]))
})

test('unrelated or expired clarification never forwards historical material',async t=>{
 for(const expired of [false,true]){
 const f=await fixture(t,{action:'clarify',projectId:null,question:'Which project?'})
 await f.router.process(f.message,f.token,{text:'file metadata',attachments:[{path:'/private/example.pdf',name:'example.pdf'}]})
 if(expired)f.root.alice.entryClarification.createdAt=Date.now()-600001
 const answer={...f.message,text:'A new task',raw:{message_id:'unrelated'}};answer._ingressId=f.jobs.capture(answer)
 f.router.classify=async input=>{if(expired)assert.equal(input.pendingClarification,null);return {action:'task',projectId:'2',useClarification:expired,useAttachments:true}}
 await f.router.process(answer,f.token);assert.equal(f.jobs.pending()[0].input.attachments,undefined)
 }
})

test('desktop return routes independently while execution is held and receives only scoped handoff metadata',async t=>{
 const f=await fixture(t,{action:'desktop_return',projectId:'2',question:null})
 f.manager.state.desktopHandoff={owner:'alice',projectId:'2',threadId:'p',workspace:f.manager.workspaceFor('project'),phase:'desktop'}
 f.service.desktop={readAfterClose:async id=>({threadId:id})}
 f.router.classify=async input=>{assert.deepEqual(input.desktopHandoff,{projectId:'2',phase:'desktop'});return {action:'desktop_return',projectId:'2',question:null}}
 await f.router.process(f.message,f.token)
 assert.equal(f.manager.state.desktopHandoff,undefined);assert.equal(f.jobs.pending().length,0);assert.match(f.sent[0],/已回到微信/)
})
test('desktop status reads outside the task queue without opening an application',async t=>{
 const f=await fixture(t,{action:'desktop_status',projectId:'1',question:null})
 f.service.desktop={status:async()=>({enabled:false,supported:true})}
 await f.router.process(f.message,f.token);assert.equal(f.jobs.pending().length,0);assert.match(f.sent[0],/尚未就绪/)
})

test('successful dispatch supplies follow-up focus without changing navigation; explicit switch expires it',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',title:'重做教材游戏'});await f.router.process(f.message,f.token)
 assert.equal(f.root.alice.active,'1')
 const follow={...f.message,text:'不错，这个像一回事了',raw:{message_id:'follow'}};follow._ingressId=f.jobs.capture(follow)
 f.router.classify=async input=>{assert.equal(input.currentProjectId,'1');assert.equal(input.conversationFocus.projectId,'2');return {action:'task',projectId:'2',title:'游戏反馈'}}
 await f.router.process(follow,f.token);assert.equal(f.jobs.pending().at(-1).owner,'project')
 f.root.alice.selectionVersion=1
 const next={...f.message,text:'新的话题',raw:{message_id:'new'}};next._ingressId=f.jobs.capture(next)
 f.router.classify=async input=>{assert.equal(input.conversationFocus,undefined);return {action:'task',projectId:'1'}}
 await f.router.process(next,f.token);assert.equal(f.root.alice.active,'1')
})

test('a standalone definition question reaches the current project without model classification',async t=>{
 const f=await fixture(t)
 f.message.text='什么是光合作用？'
 await f.router.process(f.message,f.token)
 assert.equal(f.count(),0)
 assert.equal(f.jobs.pending()[0].owner,'alice')
 assert.equal(f.jobs.pending()[0].input.text,f.message.text)
 await f.router.process(f.message,f.token)
 assert.equal(f.jobs.pending().length,1)
})

test('the exact routing latency question reads previous metrics without a model call',async t=>{
 const f=await fixture(t)
 f.root.alice.entryRoutingMetrics={classified:3,lastLatencyMs:7132}
 f.message.text='入口识别耗时多少？'
 await f.router.process(f.message,f.token)
 assert.equal(f.count(),0)
 assert.match(f.sent[0],/7132 毫秒/)
})

test('accepted project queries shift the conversation topic while background deliveries do not',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',title:'修复搜索'})
 await f.router.process(f.message,f.token)
 const next=async(id,text)=>{
  const message={...f.message,text,raw:{message_id:id}}
  message._ingressId=f.jobs.capture(message)
  await f.router.process(message,f.token)
 }
 f.router.classify=async()=>({action:'status',projectId:'1',title:'查询发布进度'})
 await next('query','查一下 Current 的发布进度')
 await f.router.deliver('alice','Project 的搜索修复已完成')
 let observed
 f.router.classify=async input=>{observed=input;return {action:'stop',projectId:'1'}}
 await next('follow','把那个停掉')
 assert.equal(observed.conversationFocus.title,'查询发布进度')
 assert.deepEqual(observed.recentTopics.map(t=>t.title),['查询发布进度','修复搜索'])
 assert.match(f.sent.at(-1),/哪个项目/)
 assert.equal(f.root.alice.active,'1')
})

for(const text of ['能把刚才第二段写得更自然一些吗？','帮 Project 检查搜索','切换到 Project']){
 test(`idle conversation handles “${text}” without separate model classification`,async t=>{
  const f=await fixture(t)
  f.router.canAnswerDirectly=true
  f.manager.sessions.clear()
  // Work in a different project must not slow down the current conversation.
  f.jobs.add('project',{text:'background work'},'other')
  f.message.text=text
  await f.router.process(f.message,f.token)
  assert.equal(f.count(),0)
  const jobs=f.jobs.pending().filter(j=>j.owner==='alice')
  assert.equal(jobs.length,1)
  assert.equal(jobs[0].input.text,text)
 })
}

test('catalog and pagination requests fall through to the normal model queue even when busy',async t=>{
 const f=await fixture(t)
 for(const text of ['当前都有哪些项目？','当前都有哪些会话','更多会话']){
  f.message.text=text
  assert.equal(await f.router.process(f.message,f.token),false)
 }
 assert.equal(f.count(),0)
 assert.deepEqual(f.sent,[])
})
test('busy tool-enabled project still routes a follow-up independently',async t=>{
 const f=await fixture(t,{action:'status',projectId:'1'})
 f.router.canAnswerDirectly=true
 f.message.text='现在怎么样了？'
 await f.router.process(f.message,f.token)
 assert.equal(f.count(),1)
 assert.equal(f.jobs.pending().length,0)
})

test('bare switch reaches the idle conversation with its history without a classifier turn',async t=>{
 const f=await fixture(t)
 f.router.canAnswerDirectly=true
 f.manager.sessions.clear()
 f.message.text='切换'
 await f.router.process(f.message,f.token)
 assert.equal(f.count(),0)
 assert.equal(f.jobs.pending()[0].input.text,'切换')
 assert.equal(f.root.alice.active,'1')
})

test('classifier disconnect records the waiting stage and elapsed time before fallback',async t=>{
 const f=await fixture(t,null),events=[]
 f.message._traceId='debug-trace'
 f.router.log=(event,fields)=>events.push({event,...fields})
 f.router.classify=async()=>{assert.equal(events.at(-1).event,'routing.classifying');throw Error('ENTRY_ROUTER_DISCONNECTED')}
 assert.equal(await f.router.process(f.message,f.token),false)
 assert.deepEqual(events.map(e=>e.event),['routing.classifying','routing.failed'])
 assert.equal(events[1].reason,'error')
 assert.equal(events[1].trace_id,'debug-trace')
 assert.ok(events[1].duration_ms>=0)
})
