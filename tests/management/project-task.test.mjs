import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {createWeChatPresenter} from '../../src/interfaces/views/wechat-presenter.mjs'
import {managementTools} from '../../src/application/management/tools.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'project-dispatch-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 for(const folder of ['entry','knowledge','toolbox','state'])await mkdir(join(dir,folder))
 const manager=new SessionManager({stateDir:join(dir,'state'),cwd:join(dir,'entry'),owners:['alice','bob'],providerEnv:{},rpcFactory:()=>{throw Error('unexpected real model connection')}})
 manager.state.users={alice:{threadId:'entry-thread'},bob:{threadId:'bob-thread'},knowledge:{threadId:'knowledge-thread',workspace:join(dir,'knowledge')},toolbox:{threadId:'toolbox-thread',workspace:join(dir,'toolbox')}}
 let persisted;manager.save=async()=>{persisted=structuredClone(manager.state)}
 const conversations=new TextConversations(manager,['alice','bob'],()=>({}),{capabilities:{catalog:false,history:false},confirmSession:async()=>{throw Error('unexpected confirm')},withConnection:async()=>{throw Error('unexpected backend query')}})
 conversations.root.alice.entries.push({id:'2',key:'knowledge',name:'知识库'},{id:'3',key:'toolbox',name:'工具箱'})
 manager.owners.add('knowledge');manager.owners.add('toolbox')
 const jobs=new DurableJobs(join(dir,'jobs.db'));t.after(()=>jobs.close());manager.submissions=jobs
 const sent=[],view=createWeChatPresenter({conversations,bot:{},runtime:{},outgoing:{deliver:async(key,value,options)=>{sent.push({key,value,options});await options?.checkpoint?.();return {status:'accepted'}}}})
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>jobs.add(...args)});t.after(()=>service.close())
 const queue=new DurableIntake({jobs,manager,conversations,reply:(...args)=>view.deliver(...args)});t.after(()=>queue.close())
 return {dir,manager,conversations,jobs,service,queue,sent,view,persisted:()=>persisted}
}
const task=(overrides={})=>({projectId:'2',text:'检查知识库搜索功能，不改动其他项目。',requestId:'new-task',...overrides})

test('cross-project submission persists exactly one task, preserves selection and caller context, and distinguishes queued from completed',async t=>{
 const f=await fixture(t),args=task(),before=structuredClone(f.manager.state.users.alice)
 const result=await f.service.call('alice','submit_project_task',args)
 assert.equal(result.status,'queued');assert.equal(result.data.switched,false);assert.equal(result.data.returnTo,'current_entry')
 const job=f.jobs.get(result.data.taskId);assert.equal(job.owner,'knowledge');assert.equal(job.state,'pending');assert.equal(job.input.text,args.text)
 assert.equal(job.input.projectDispatch.originKey,'alice');assert.equal(job.input.projectDispatch.threadId,'knowledge-thread')
 assert.equal(f.conversations.root.alice.active,'1');assert.deepEqual(f.manager.state.users.alice,before);assert.equal(f.manager.sessions.size,0)
 const repeated=await f.service.call('alice','submit_project_task',args);assert.equal(repeated.operationId,result.operationId);assert.equal(f.jobs.pending().length,1)
 await assert.rejects(f.service.call('alice','submit_project_task',task({text:'different'})),/MANAGEMENT_REQUEST_CONFLICT/)
 const spec=managementTools.find(tool=>tool.name==='submit_project_task');assert.equal(spec.annotations.readOnlyHint,false);assert.equal(spec.annotations.idempotentHint,true)
})

test('task submission rejects unavailable targets, current-project recursion, foreign fields and a full queue',async t=>{
 const f=await fixture(t)
 const current=await f.service.call('alice','submit_project_task',task({projectId:'1'}));assert.equal(current.detail,'MANAGEMENT_ALREADY_IN_PROJECT')
 await assert.rejects(f.service.call('alice','submit_project_task',task({owner:'bob',requestId:'spoof'})),/MANAGEMENT_INVALID_ARGUMENTS/)
 const foreign=await f.service.call('bob','submit_project_task',task());assert.equal(foreign.status,'rejected');assert.equal(foreign.detail,'MANAGEMENT_TARGET_NOT_FOUND')
 assert.equal(f.jobs.pending().length,0)
})

test('archived, deleting and missing projects cannot accept new dispatched tasks',async t=>{
 const f=await fixture(t),entry=f.conversations.root.alice.entries.find(e=>e.id==='2')
 for(const [index,patch]of [{archived:true},{archiveIntent:false},{deleteIntent:true},{archiveSync:'missing'}].entries()){
  Object.assign(entry,patch)
  const result=await f.service.call('alice','submit_project_task',task({requestId:'unavailable-'+index}))
  assert.equal(result.status,'rejected');assert.equal(result.detail,patch.deleteIntent?'MANAGEMENT_TARGET_NOT_FOUND':'MANAGEMENT_TARGET_UNAVAILABLE')
  for(const key of Object.keys(patch))delete entry[key]
 }
 assert.equal(f.jobs.pending().length,0)
 for(let i=0;i<5;i++)f.jobs.add('knowledge',{text:'queued '+i},'queue-'+i)
 const full=await f.service.call('alice','submit_project_task',task({requestId:'full'}));assert.equal(full.detail,'MANAGEMENT_PROJECT_QUEUE_FULL')
 assert.equal(f.jobs.pending().length,5)
})

test('routed progress, approval prompts and result bundles return immediately with project and task labels, without flushing legacy unread output',async t=>{
 const f=await fixture(t),entry=f.conversations.root.alice.entries.find(e=>e.id==='2')
 entry.unread=[{value:'old hidden result',state:'pending'}]
 const response=await f.service.call('alice','submit_project_task',task())
 const packet={kind:'bundle',text:'搜索修复结果',attachments:[{id:'snapshot'}],textParts:[]}
 f.manager.ask=async(key,input,reply)=>{
  assert.equal(key,'knowledge');assert.equal(input.deliveryId,response.data.taskId)
  f.jobs.context(response.data.taskId,{executionModel:'gpt-6.1-sol'})
  f.manager.state.users[key].modelOverride='gpt-6-astra'
  await reply('正在检查搜索');await reply('审批：是否允许指定操作？');await reply(packet,{checkpoint:()=>f.manager.save()})
  f.manager.state.users[key].lastReply='搜索修复结果'
 }
 await f.queue.pump('knowledge')
 assert.equal(f.jobs.get(response.data.taskId).state,'done');assert.equal(f.sent.length,3)
 for(const output of f.sent){assert.equal(output.key,'knowledge');assert.match(typeof output.value==='string'?output.value:output.value.text,/^【知识库 · [^】]+】/);assert(!JSON.stringify(output.value).includes('old hidden result'));assert(!JSON.stringify(output.value).includes(response.data.taskId.slice(0,8)));assert.match(typeof output.value==='string'?output.value:output.value.text,/检查知识库搜索功能/)}
 assert(f.sent.every(out=>(typeof out.value==='string'?out.value:out.value.text).split('\n')[0].endsWith(' · gpt-6.1-sol】')));assert.equal(f.sent[2].value.attachments,packet.attachments);assert.equal(packet.text,'搜索修复结果')
 assert.equal(entry.unread.length,1);assert.equal(f.conversations.root.alice.active,'1');assert.equal(f.manager.state.users.alice.lastReply,undefined)
 // Normal non-routed output retains the existing unread behavior.
 const ordinary=await f.view.deliver('knowledge','normal background result');assert.equal(ordinary.status,'deferred');assert.equal(f.sent.length,3)
})

test('queued tasks revalidate thread, workspace and archive state before execution and report no execution',async t=>{
 for(const change of ['thread','workspace','archive']){
  const f=await fixture(t),result=await f.service.call('alice','submit_project_task',task())
  if(change==='thread')f.manager.state.users.knowledge.threadId='replacement-thread'
  if(change==='workspace')f.manager.state.users.knowledge.workspace=join(f.dir,'toolbox')
  if(change==='archive')f.conversations.root.alice.entries.find(e=>e.id==='2').archived=true
  f.manager.ask=async()=>assert.fail('changed target must not execute')
  await f.queue.pump('knowledge')
  assert.equal(f.jobs.get(result.data.taskId).state,'cancelled');assert.equal(f.sent.length,1);assert.match(f.sent[0].value,/任务未执行/)
 }
})

test('a routed task cannot recursively dispatch to another project, and the current project identity differs from UI selection',async t=>{
 const f=await fixture(t),result=await f.service.call('alice','submit_project_task',task())
 f.manager.sessions.set('knowledge',{taskId:result.data.taskId})
 const projects=await f.service.call('knowledge','list_projects',{})
 assert.equal(projects.callerProjectId,'2');assert.equal(projects.projects.find(e=>e.active).projectId,'1')
 const nested=await f.service.call('knowledge','submit_project_task',task({projectId:'3',requestId:'nested'}))
 assert.equal(nested.status,'rejected');assert.equal(nested.detail,'MANAGEMENT_NESTED_DISPATCH_DENIED');assert.equal(f.jobs.pending().length,1)
})

test('unknown queue insertion outcomes never generate a fresh task or automatically replay on restart',async t=>{
 const f=await fixture(t);let inserted
 f.service.enqueueTask=(...args)=>{inserted=f.jobs.add(...args);throw Error('lost acknowledgement')}
 const args=task(),result=await f.service.call('alice','submit_project_task',args)
 assert.equal(result.status,'unknown');assert.equal(result.data.taskId,inserted);assert.equal(f.jobs.pending().length,1)
 const restored=new ManagementService({manager:f.manager,conversations:f.conversations,enqueueTask:()=>assert.fail('must not reinsert')});t.after(()=>restored.close())
 const duplicate=await restored.call('alice','submit_project_task',args)
 assert.equal(duplicate.status,'unknown');assert.equal(duplicate.operationId,result.operationId);assert.equal(f.jobs.pending().length,1)
})

test('forged delivery routes cannot bypass unread isolation or send another user results',async t=>{
 const f=await fixture(t),id=f.jobs.add('knowledge',{text:'ordinary task'},'ordinary')
 await assert.rejects(f.view.deliver('knowledge','secret',{projectTaskId:id}),/PROJECT_TASK_ROUTE_INVALID/)
 const routed=await f.service.call('alice','submit_project_task',task())
 await assert.rejects(f.view.deliver('bob','secret',{projectTaskId:routed.data.taskId}),/PROJECT_TASK_ROUTE_INVALID/)
 await assert.rejects(f.view.deliver('unregistered-recipient','secret',{projectTaskId:routed.data.taskId}),/PROJECT_TASK_ROUTE_INVALID/)
 const forged=f.jobs.add('knowledge',{text:'forged',projectDispatch:{version:1,operationId:'00000000-0000-0000-0000-000000000000',originKey:'bob',projectId:'2'}},'fake-key')
 await assert.rejects(f.view.deliver('knowledge','secret',{projectTaskId:forged}),/PROJECT_TASK_ROUTE_INVALID/)
 assert.equal(f.sent.length,0)
})

test('multiple projects execute independently while each project preserves FIFO and origin cancellation does not retarget tasks',async t=>{
 const f=await fixture(t),a=await f.service.call('alice','submit_project_task',task()),b=await f.service.call('alice','submit_project_task',task({requestId:'second',text:'第二条知识库任务'})),c=await f.service.call('alice','submit_project_task',task({projectId:'3',requestId:'toolbox',text:'工具箱任务'}))
 f.manager.lifecycle.cancel('alice')
 const started=[],release={}
 f.manager.ask=async(key,input,reply)=>{
  started.push(input.deliveryId)
  if(input.deliveryId===a.data.taskId)await new Promise(resolve=>{release.first=resolve})
  await reply('完成 '+input.text)
 }
 const knowledge=f.queue.pump('knowledge'),toolbox=f.queue.pump('toolbox')
 await toolbox
 assert.deepEqual(started,[a.data.taskId,c.data.taskId]);assert.equal(f.jobs.get(b.data.taskId).state,'pending')
 release.first();await knowledge
 assert.deepEqual(started,[a.data.taskId,c.data.taskId,b.data.taskId]);assert.equal(f.sent.length,3)
 assert(f.sent.some(out=>String(out.value).includes('【工具箱 · ')));assert.equal(f.conversations.root.alice.active,'1')
})

test('routing survives a database reopen and expired management receipts without replaying completed tasks',async t=>{
 const f=await fixture(t),result=await f.service.call('alice','submit_project_task',task())
 const reopened=new DurableJobs(join(f.dir,'jobs.db'));t.after(()=>reopened.close());f.manager.submissions=reopened
 f.service.operations.splice(0)
 const queue=new DurableIntake({jobs:reopened,manager:f.manager,conversations:f.conversations,reply:(...args)=>f.view.deliver(...args)});t.after(()=>queue.close())
 let calls=0;f.manager.ask=async(key,input,reply)=>{calls++;assert.equal(key,'knowledge');await reply('重启后完成任务')}
 queue.resume();await queue.users.get('knowledge')
 assert.equal(calls,1);assert.equal(reopened.get(result.data.taskId).state,'done');assert.match(f.sent[0].value,/【知识库 · /)
 queue.resume();assert.equal(queue.users.size,0);assert.equal(calls,1)
})

test('bound task recovery retains its routed completion notice and only reads the original turn',async t=>{
 const f=await fixture(t),result=await f.service.call('alice','submit_project_task',task()),id=result.data.taskId
 f.jobs.bind(id,'knowledge-thread');f.jobs.submitted(id,'original-turn')
 const session={userId:'knowledge',threadId:'knowledge-thread',rpc:{},busy:false}
 f.manager.connect=async(_key,reply)=>{session.reply=reply;return session}
 f.manager.protocol.recoverTurn=async(_rpc,value)=>{assert.equal(value.threadId,'knowledge-thread');assert.equal(value.turnId,'original-turn');return {id:'original-turn',status:'completed',items:[{type:'agentMessage',text:'原任务结果'}]}}
 f.manager.ask=async()=>assert.fail('recovery must not start another execution')
 await f.queue.pump('knowledge')
 assert.equal(session.taskId,id);assert.equal(f.jobs.get(id).state,'done');assert.equal(f.manager.state.users.knowledge.lastReply,'原任务结果')
 assert.equal(f.manager.state.users.knowledge.resultIdentity.taskId,id);assert.equal(f.sent.length,1);assert.match(f.sent[0].value,/【知识库 · .*已找回/s)
})

test('queue persistence failure never acknowledges a completed submission or switches selection',async t=>{
 const f=await fixture(t);f.service.enqueueTask=()=>{throw Error('database unavailable')}
 const args=task(),result=await f.service.call('alice','submit_project_task',args)
 assert.equal(result.status,'unknown');assert.equal(f.jobs.pending().length,0);assert.equal(f.conversations.root.alice.active,'1')
 assert.equal((await f.service.call('alice','submit_project_task',args)).operationId,result.operationId)
})

test('routing errors after model execution begins remain uncertain rather than claiming no execution',async t=>{
 const f=await fixture(t),result=await f.service.call('alice','submit_project_task',task())
 f.manager.ask=async()=>{throw Error('PROJECT_TASK_ROUTE_INVALID')}
 await f.queue.pump('knowledge')
 assert.equal(f.jobs.get(result.data.taskId).state,'uncertain');assert.equal(f.sent.length,1)
 assert.match(f.sent[0].value,/结果尚未确认/);assert(!f.sent[0].value.includes('任务未执行'))
})
