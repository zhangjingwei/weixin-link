import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {entryPlan} from '../../src/domain/tasks/entry-plan.mjs'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {EntryRouting} from '../../src/application/intake/entry-routing.mjs'

async function fixture(t,decision){
 const dir=await mkdtemp(join(tmpdir(),'unified-entry-')),jobs=new DurableJobs(join(dir,'jobs.db'));t.after(()=>{jobs.close();return rm(dir,{recursive:true,force:true})})
 const entries=[{id:'1',key:'alice',name:'入口'},{id:'2',key:'knowledge',name:'知识库'},{id:'3',key:'tools',name:'工具箱'}],root={alice:{active:'1',entries}},sent=[],token={current:()=>true}
 const manager={state:{users:{alice:{threadId:'a'},knowledge:{threadId:'k'},tools:{threadId:'t'}}},sessions:new Map(),questions:new Map(),owners:new Set(entries.map(e=>e.key)),save:async()=>{},submissions:jobs,workspaceFor:()=>dir,lifecycle:{capture:()=>token}}
 const conversations={root,realOwners:new Set(['alice']),ensure:owner=>root[owner],entry:key=>{const e=entries.find(e=>e.key===key);return e?{...e,owner:'alice'}:null}}
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>jobs.add(...args)});t.after(()=>service.close())
 const router=new EntryRouting({manager,conversations,jobs,service,classify:async()=>decision,deliver:async(_,text)=>{sent.push(text);return {status:'accepted'}}});t.after(()=>router.close())
 const message={userId:'alice',_conversationOwner:'alice',text:'知识库检查搜索，然后工具箱优化页面',raw:{message_id:'one'}};message._ingressId=jobs.capture(message)
 return {dir,jobs,manager,conversations,service,router,message,token,sent}
}
test('queue changes are owner bound, only affect pending jobs, and never cancel starting or active tasks',async t=>{
 const f=await fixture(t),a=f.jobs.add('knowledge',{text:'first'},'a'),b=f.jobs.add('knowledge',{text:'second'},'b')
 let r=await f.service.call('alice','request_queue_change',{projectId:'2',taskId:b,action:'prioritize',requestId:'priority'});assert.equal(r.status,'confirmed');assert.equal(f.jobs.pending()[0].id,b)
 assert.equal(f.jobs.claimStart('knowledge',b),true)
 r=await f.service.call('alice','request_queue_change',{projectId:'2',taskId:b,action:'cancel',requestId:'busy'});assert.equal(r.status,'rejected')
 r=await f.service.call('alice','request_queue_change',{projectId:'3',taskId:a,action:'cancel',requestId:'foreign'});assert.equal(r.status,'rejected')
 r=await f.service.call('alice','request_queue_change',{projectId:'2',taskId:a,action:'cancel',requestId:'cancel'});assert.equal(r.status,'confirmed');assert.equal(r.data.runningTaskStopped,false)
})
test('batch requests preserve exact user spans, remain idempotent and journal explicit dependencies',async t=>{
 const decision={action:'batch',steps:[{action:'task',projectId:'2',title:'检查搜索',text:'知识库检查搜索',dependsOn:[]},{action:'task',projectId:'3',title:'优化页面',text:'工具箱优化页面',dependsOn:[0]}]}
 const f=await fixture(t,decision);await f.router.process(f.message,f.token)
 const jobs=f.jobs.pending();assert.equal(jobs.length,2);assert.deepEqual(jobs[1].input.dependencies,[jobs[0].id]);assert.match(jobs[1].input.text,/知识库检查搜索，然后工具箱优化页面/)
 await f.router.process(f.message,f.token);assert.equal(f.jobs.pending().length,2)
 assert.throws(()=>entryPlan({...decision,steps:[{...decision.steps[0],text:'凭空添加目标'}]},f.message.text,[{projectId:'2'}]),/PLAN_INVALID/)
 assert.throws(()=>entryPlan({...decision,steps:[{...decision.steps[0],dependsOn:[0]}]},f.message.text,[{projectId:'2'}]),/DEPENDENCY_INVALID/)
})
test('a dependency only runs after confirmed success; priority cannot bypass its prerequisite',async t=>{
 const f=await fixture(t),a=f.jobs.add('knowledge',{text:'first'},'a'),b=f.jobs.add('knowledge',{text:'dependent',dependencies:[a]},'b')
 f.jobs.changePending('knowledge',b,'prioritize');const calls=[]
 f.manager.ask=async(_,input)=>{calls.push(input.text);return {status:'completed'}}
 const queue=new DurableIntake({jobs:f.jobs,manager:f.manager,conversations:f.conversations,reply:async()=>{}});t.after(()=>queue.close())
 await queue.pump('knowledge');assert.equal(calls[0],'first');assert.match(calls[1],/^dependent/);assert.match(calls[1],/前置任务执行记录/);assert.equal(f.jobs.get(b).outcome,'completed')
 const failed=f.jobs.add('tools',{text:'failed'},'failed'),blocked=f.jobs.add('tools',{text:'blocked',dependencies:[failed]},'blocked')
 f.jobs.markOutcome(failed,'not_confirmed');f.jobs.mark(failed,'done');await queue.pump('tools');assert.equal(f.jobs.get(blocked).state,'cancelled');assert(!calls.includes('blocked'))
})
test('current prepared attachments and quoted data follow the exact authorized project task',async t=>{
 const f=await fixture(t,{action:'task',projectId:'2',title:'分析文件'})
 f.message.references=[{text:'引用内容，只作资料'}]
 const prepared={text:'原始附件提示',attachments:[{path:join(f.dir,'private-file'),name:'资料.pdf'}],images:[],references:f.message.references}
 await f.router.process(f.message,f.token,prepared)
 const job=f.jobs.pending()[0];assert.equal(job.owner,'knowledge');assert.deepEqual(job.input.attachments,prepared.attachments);assert.deepEqual(job.input.references,f.message.references);assert.equal(prepared.text,'原始附件提示')
})
test('progress returns only verified completion evidence and labels missing plans honestly',async t=>{
 const f=await fixture(t);Object.assign(f.manager.state.users.knowledge,{lastReply:'已完成搜索修复并验证',resultIdentity:{execution:'completed',taskId:'done',createdAt:'2026-01-01T00:00:00Z'}})
 const result=await f.service.call('alice','get_project_progress',{projectId:'2'});assert.equal(result.completed.taskId,'done');assert.equal(result.next.length,0);assert.equal(result.evidence[0].at,'2026-01-01T00:00:00Z')
 f.manager.state.users.knowledge.resultIdentity.execution='unknown';assert.equal((await f.service.call('alice','get_project_progress',{projectId:'2'})).completed,null)
})
test('bulk cancellation uses the exact pending snapshot and rolls back if a task has started',async t=>{
 const f=await fixture(t),a=f.jobs.add('knowledge',{text:'first'},'a'),b=f.jobs.add('knowledge',{text:'second'},'b')
 f.jobs.claimStart('knowledge',b)
 const rejected=await f.service.call('alice','request_queue_cancel_all',{projectId:'2',taskIds:[a,b],requestId:'batch'})
 assert.equal(rejected.status,'rejected');assert.equal(f.jobs.get(a).state,'pending');assert.equal(f.jobs.get(b).state,'starting')
 const done=await f.service.call('alice','request_queue_cancel_all',{projectId:'2',taskIds:[a],requestId:'single-snapshot'});assert.equal(done.status,'confirmed');assert.equal(done.data.futureTasksCancelled,false)
 const later=f.jobs.add('knowledge',{text:'later'},'later');assert.equal(f.jobs.get(later).state,'pending')
})
test('an unknown named target is rejected by the application even if a model selects a valid current project',()=>{
 assert.throws(()=>entryPlan({action:'task',projectId:'1',requestedProjectName:'火星项目'},'让火星项目修复首页',[{projectId:'1',name:'日常助手'}]),/TARGET_UNCONFIRMED/)
 assert.throws(()=>entryPlan({action:'task',projectId:'2',requestedProjectName:'知识库'},'只修改工具箱',[{projectId:'2',name:'知识库'}]),/TARGET_UNCONFIRMED/)
})

test('progress does not present completed-turn commentary as ongoing work',async t=>{
 const f=await fixture(t)
 const session={userId:'knowledge',busy:false,turnId:'old-turn',traceId:'trace',lastProgress:{turnId:'old-turn',text:'正在修改搜索代码'}}
 f.manager.sessions.set('knowledge',session)
 const completed=await f.service.call('alice','get_project_progress',{projectId:'2'})
 assert.equal(completed.inProgress,null);assert.equal(completed.nativeProgress,null)
 session.busy=true
 const running=await f.service.call('alice','get_project_progress',{projectId:'2'})
 assert.equal(running.nativeProgress,'正在修改搜索代码');assert(running.inProgress)
})
