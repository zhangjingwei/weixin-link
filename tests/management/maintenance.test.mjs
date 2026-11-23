import test from 'node:test'
import assert from 'node:assert/strict'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {managementTools} from '../../src/application/management/tools.mjs'

function fixture(t){
 const calls=[],root={alice:{active:'1',entries:[{id:'1',key:'alice',name:'入口'},{id:'2',key:'project',name:'项目'}]},bob:{active:'1',entries:[{id:'1',key:'bob',name:'Bob'}]}}
 const manager={state:{users:{alice:{threadId:'a'},project:{threadId:'p'},bob:{threadId:'b'}}},sessions:new Map([['alice',{busy:true,traceId:'caller-task'}]]),questions:new Map(),save:async()=>calls.push('save')}
 const conversations={root,backendPort:{capabilities:{catalog:true}},realOwners:new Set(['alice','bob']),entry:key=>{for(const [owner,r]of Object.entries(root)){const e=r.entries.find(e=>e.key===key);if(e)return {...e,owner}}},displayName:(_owner,e)=>e.name}
 const maintenance={serviceStatus:async()=>({ready:true,idle:false}),installationStatus:async()=>({inferenceVerified:false}),diagnostics:async()=>({recent_failures:[]}),guide:async language=>({text:language==='en'?'Guide':'说明'}),status:async()=>({restart:null,upgrade:null}),restart:async()=>{calls.push('restart');return {status:'scheduled',maintenanceId:'restart-worker'}},upgrade:async release=>{calls.push(release);return {status:'scheduled',maintenanceId:'upgrade-worker',version:release.tag}}}
 const service=new ManagementService({manager,conversations,maintenance,updates:{query:async()=>({latest:{tag:'v2.0.0',commit:'a'.repeat(40)}})},notice:async()=>{}});t.after(()=>service.close())
 return {service,manager,conversations,maintenance,calls}
}

test('service reads do not schedule maintenance or mark inference verified',async t=>{
 const f=fixture(t)
 assert.equal((await f.service.call('alice','get_service_status',{})).ready,true)
 assert.equal((await f.service.call('alice','get_installation_status',{})).inferenceVerified,false)
 assert.deepEqual(await f.service.call('alice','get_diagnostics',{}),{recent_failures:[]})
 assert.equal((await f.service.call('alice','get_usage_guide',{language:'en'})).text,'Guide')
 assert.deepEqual(await f.service.call('alice','get_maintenance_status',{}),{restart:null,upgrade:null,requests:[]});assert.equal(f.calls.length,0)
 await assert.rejects(f.service.call('alice','request_service_restart',{requestId:'x',accountId:'bob'}),/INVALID_ARGUMENTS/)
})
test('restart is deferred until activation and only schedules the original worker, even while caller is busy',async t=>{
 const f=fixture(t),args={requestId:'restart'}
 const pending=await f.service.call('alice','request_service_restart',args)
 assert.equal(pending.status,'pending');assert.equal(pending.data.scope,'current_account');assert(!f.calls.includes('restart'))
 const op=f.service.operations.find(o=>o.id===pending.operationId);await f.service.execute(op)
 assert.equal(op.status,'scheduled');assert.equal(op.data.completed,false);assert.equal(op.data.maintenanceId,'restart-worker')
 assert.equal(f.calls.filter(c=>c==='restart').length,1)
 assert.equal((await f.service.call('alice','request_service_restart',args)).operationId,op.id)
 await f.service.execute(op);assert.equal(f.calls.filter(c=>c==='restart').length,1)
})
test('upgrade binds checked version and commit; forged or foreign release credentials cannot schedule',async t=>{
 const f=fixture(t),checked=await f.service.call('alice','check_updates',{})
 const args={updateToken:checked.updateToken,requestId:'upgrade'},pending=await f.service.call('alice','request_upgrade',args)
 assert.equal(pending.status,'pending');assert.equal(pending.data.scope,'installation');assert.equal(pending.data.version,'v2.0.0')
 await f.service.execute(f.service.operations.find(o=>o.id===pending.operationId))
 assert.deepEqual(f.calls.find(c=>typeof c==='object'),{tag:'v2.0.0',commit:'a'.repeat(40)})
 const foreign=await f.service.call('bob','request_upgrade',{...args,requestId:'foreign'});assert.equal(foreign.status,'rejected')
 const forged=await f.service.call('alice','request_upgrade',{updateToken:'invalid',requestId:'forged'});assert.equal(forged.status,'rejected')
})
test('maintenance restart recovery never blindly schedules executing or pending requests',async t=>{
 const f=fixture(t),pending=await f.service.call('alice','request_service_restart',{requestId:'restart'})
 const restored=new ManagementService({manager:f.manager,conversations:f.conversations,maintenance:f.maintenance});t.after(()=>restored.close())
 assert.equal((await restored.call('alice','get_management_operation',{operationId:pending.operationId})).status,'not_executed')
 assert(!f.calls.includes('restart'))
})
test('unknown scheduler outcomes are not reported complete and cannot be replayed with the same request',async t=>{
 const f=fixture(t);f.maintenance.restart=async()=>{f.calls.push('restart');throw Error('lost scheduler response')}
 const args={requestId:'unknown'},pending=await f.service.call('alice','request_service_restart',args),op=f.service.operations.find(o=>o.id===pending.operationId)
 await f.service.execute(op);assert.equal(op.status,'unknown');assert.equal(op.data.completed,false)
 await f.service.call('alice','request_service_restart',args);assert.equal(f.calls.filter(c=>c==='restart').length,1)
})
test('archive waits for its own caller to finish and uses the original archive use case',async t=>{
 const f=fixture(t);let archives=0
 f.conversations.archive=async(owner,entry,archived)=>{archives++;assert.equal(owner,'alice');entry.archived=archived;return {status:'confirmed',archived}}
 const pending=await f.service.call('alice','request_project_archive',{projectId:'1',archived:true,requestId:'archive'}),op=f.service.operations.find(o=>o.id===pending.operationId)
 await f.service.execute(op);assert.equal(archives,0);assert.equal(op.status,'pending')
 f.manager.sessions.get('alice').busy=false
 await f.service.execute(op);assert.equal(archives,1);assert.equal(op.status,'confirmed');assert.equal(op.data.archived,true)
})
test('archive stale threads and unknown official results cannot be reported confirmed',async t=>{
 const f=fixture(t);f.conversations.archive=async()=>({status:'unknown'})
 const args={projectId:'2',archived:false,requestId:'restore'},pending=await f.service.call('alice','request_project_archive',args)
 await f.service.execute(f.service.operations.find(o=>o.id===pending.operationId));assert.equal(f.service.operations.at(-1).status,'unknown')
 const next=await f.service.call('alice','request_project_archive',{...args,requestId:'stale'})
 f.manager.state.users.project.threadId='changed'
 await f.service.execute(f.service.operations.find(o=>o.id===next.operationId));assert.equal(f.service.operations.at(-1).status,'not_executed')
})
test('maintenance tool schemas retain closed arguments and mark writes explicitly',()=>{
 for(const name of ['request_upgrade','request_service_restart','request_project_archive']){
  const spec=managementTools.find(t=>t.name===name);assert(spec);assert.equal(spec.annotations.readOnlyHint,false);assert.equal(spec.inputSchema.additionalProperties,false)
 }
})


test('maintenance status distinguishes a new pending request from an older completed worker',async t=>{
 const f=fixture(t)
 f.maintenance.status=async()=>({restart:null,upgrade:{id:'old-worker',version:'v1.0.0',status:'complete'}})
 const checked=await f.service.call('alice','check_updates',{})
 const pending=await f.service.call('alice','request_upgrade',{updateToken:checked.updateToken,requestId:'new-version'})
 const status=await f.service.call('alice','get_maintenance_status',{})
 assert.equal(status.upgrade.version,'v1.0.0');assert.equal(status.requests[0].operationId,pending.operationId)
 assert.equal(status.requests[0].status,'pending');assert.equal(status.requests[0].data.version,'v2.0.0');assert.equal(status.requests[0].data.completed,false)
})
