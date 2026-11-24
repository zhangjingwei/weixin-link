import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,mkdir,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {createDesktopClient} from '../../src/infrastructure/agents/desktop-client.mjs'
import {validateConfig} from '../../src/infrastructure/config/config-schema.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {CancellationScopes} from '../../src/infrastructure/runtime/cancellation-scopes.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'

function fixture(t){
 const root={alice:{active:'1',entries:[{id:'1',key:'alice',name:'项目'}]}},events=[]
 const manager={state:{users:{alice:{threadId:'original-thread'}}},sessions:new Map(),questions:new Map(),save:async()=>events.push('save')}
 const conversations={root,realOwners:new Set(['alice']),entry:key=>key==='alice'?{...root.alice.entries[0],owner:'alice'}:null}
 const desktop={status:async()=>({supported:true,enabled:true}),prepare:async()=>events.push('prepare'),open:async id=>events.push('open:'+id),readAfterClose:async id=>{events.push('read:'+id);return {threadId:id}}}
 const service=new ManagementService({manager,conversations,desktop,notice:async()=>{}});service.resumeTasks=()=>events.push('resume');t.after(()=>service.close())
 return {manager,conversations,desktop,service,events}
}
const request=(id='open-1')=>({projectId:'1',requestId:id})

test('desktop request pauses work durably but launches only after receipt activation and idle',async t=>{
 const f=fixture(t),closed=[];f.manager.sessions.set('alice',{busy:true,rpc:{close:()=>closed.push(true)}})
 const op=await f.service.call('alice','request_desktop_handoff',request())
 assert.equal(op.status,'pending');assert.equal(f.manager.state.desktopHandoff.phase,'waiting');assert(!f.events.some(e=>e.startsWith('open:')))
 await f.service.run(f.service.operations[0]);assert(!f.events.some(e=>e.startsWith('open:')))
 for(const timer of f.service.timers.values())clearTimeout(timer);f.service.timers.clear()
 f.manager.sessions.get('alice').busy=false
 await f.service.run(f.service.operations[0])
 assert.equal(f.service.operations[0].status,'confirmed');assert.equal(f.manager.state.desktopHandoff.phase,'desktop');assert.deepEqual(closed,[true]);assert.equal(f.manager.sessions.size,0)
 assert.equal(f.service.operations[0].data.visibilityVerified,false)
 assert.equal((await f.service.call('alice','request_desktop_handoff',request())).status,'confirmed');assert.equal(f.events.filter(e=>e.startsWith('open:')).length,1)
})
test('unknown launch survives service restart and never resumes tasks automatically',async t=>{
 const f=fixture(t);f.desktop.open=async()=>{throw Error('network or launch unknown')}
 await f.service.call('alice','request_desktop_handoff',request());await f.service.run(f.service.operations[0])
 assert.equal(f.manager.state.desktopHandoff.phase,'launch_unknown');assert.equal(f.service.operations[0].status,'unknown')
 const restarted=new ManagementService({manager:f.manager,conversations:f.conversations,desktop:f.desktop});t.after(()=>restarted.close())
 assert.equal(f.manager.state.desktopHandoff.phase,'launch_unknown');assert(!f.events.includes('resume'))
})
test('return checks the bound thread and desktop exit before saving and resuming',async t=>{
 const f=fixture(t);f.manager.state.desktopHandoff={owner:'alice',projectId:'1',threadId:'original-thread',workspace:null,phase:'desktop'}
 f.desktop.readAfterClose=async()=>{throw Error('MANAGEMENT_DESKTOP_APP_STILL_RUNNING')}
 assert.equal((await f.service.call('alice','request_desktop_return',request('blocked'))).status,'rejected');assert(f.manager.state.desktopHandoff)
 f.desktop.readAfterClose=async id=>{assert.equal(id,'original-thread');f.events.push('read');return {threadId:id}}
 f.events.length=0;assert.equal((await f.service.call('alice','request_desktop_return',request('return'))).status,'confirmed')
 assert.equal(f.manager.state.desktopHandoff,undefined);assert(f.events.indexOf('save',f.events.indexOf('read'))<f.events.lastIndexOf('resume'))
})
test('foreign, multiple-owner and changed-thread requests cannot hand off or release another session',async t=>{
 const f=fixture(t);await assert.rejects(f.service.call('foreign','get_desktop_status',{}),/FORBIDDEN/)
 f.conversations.realOwners.add('bob');assert.equal((await f.service.call('alice','request_desktop_handoff',request('multi'))).detail,'MANAGEMENT_DESKTOP_SINGLE_OWNER_REQUIRED')
 f.conversations.realOwners.delete('bob');await f.service.call('alice','request_desktop_handoff',request('valid'))
 f.manager.state.users.alice.threadId='changed';await f.service.run(f.service.operations.at(-1))
 assert.equal(f.service.operations.at(-1).status,'not_executed');assert(!f.events.some(e=>e.startsWith('open:')))
 assert.equal((await f.service.call('alice','request_desktop_return',request('wrong-thread'))).status,'rejected');assert(f.manager.state.desktopHandoff)
})
test('a failed return save keeps the account paused',async t=>{
 const f=fixture(t),held=f.manager.state.desktopHandoff={owner:'alice',projectId:'1',threadId:'original-thread',workspace:null,phase:'desktop'};let saves=0
 f.manager.save=async()=>{if(++saves===2)throw Error('disk full')}
 await assert.rejects(f.service.call('alice','request_desktop_return',request()),/MANAGEMENT_STATE_UNAVAILABLE/)
 assert.equal(f.manager.state.desktopHandoff,held);assert(!f.events.includes('resume'))
})
test('paused durable queue retains jobs without spinning and resumes once released',async t=>{
 const lifecycle=new CancellationScopes(),rows=[{id:'task',owner:'alice',state:'pending',input:{text:'work'}}],calls=[]
 const jobs={pending:()=>rows.filter(r=>r.state==='pending'),mark:(id,state)=>{rows[0].state=state}}
 const manager={state:{users:{alice:{}},desktopHandoff:{phase:'desktop'}},owners:new Set(['alice']),sessions:new Map(),lifecycle,ask:async()=>{calls.push(true);return {status:'completed'}}}
 const queue=new DurableIntake({manager,jobs,reply:async()=>{}});t.after(()=>{queue.close();lifecycle.close()})
 queue.resume();assert.equal(queue.users.size,0);assert.equal(rows[0].state,'pending');assert.deepEqual(calls,[])
 delete manager.state.desktopHandoff;queue.resume();await queue.users.get('alice');assert.equal(rows[0].state,'done');assert.equal(calls.length,1)
})
async function adapter(t){
 const dir=await mkdtemp(join(tmpdir(),'desktop-adapter-')),home=join(dir,'codex-home');await mkdir(home);t.after(()=>rm(dir,{recursive:true,force:true}))
 let processes='',readStatus='notLoaded';const calls=[],rpcs=[]
 const client=createDesktopClient({account:{stateDir:dir},codexHome:home,workspace:dir,binary:'/test/codex',platform:'darwin',inspect:async path=>path.endsWith('.app')?{isDirectory:()=>true,isSymbolicLink:()=>false}:lstat(path),run:async(binary,args)=>{calls.push({binary,args});return {stdout:binary==='/bin/ps'?processes:''}},rpcFactory:options=>{rpcs.push(options);return {write(){},close(){},request:async method=>['thread/read','thread/resume'].includes(method)?{thread:{id:'thread-1',status:{type:readStatus}}}:{}}}})
 return {client,calls,rpcs,home,enable:()=>writeFile(join(dir,'desktop-handoff.json'),JSON.stringify({version:1,enabled:true,app:'ChatGPT'})),processes:value=>{processes=value},readStatus:value=>{readStatus=value}}
}
test('desktop launch is opt in, uses only private account home and a validated deep link',async t=>{
 const f=await adapter(t);assert.equal((await f.client.status()).enabled,false);await assert.rejects(f.client.open('thread-1'),/DISABLED/);assert.equal(f.calls.length,0)
 await f.enable();await f.client.open('thread-1');const open=f.calls.find(c=>c.binary==='/usr/bin/open')
 assert(open.args.includes('CODEX_HOME='+f.home));assert(open.args.includes('CODEX_SQLITE_HOME='+f.home));assert(open.args.includes('codex://threads/thread-1'));assert(!open.args.includes('--args'))
 await assert.rejects(f.client.open('bad\nthread'),/THREAD_INVALID/)
})
test('existing desktop prevents a second launch but a released thread can return',async t=>{
 const f=await adapter(t);await f.enable();f.processes('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n')
 await assert.rejects(f.client.open('thread-1'),/APP_ALREADY_RUNNING/);assert.equal((await f.client.readAfterClose('thread-1',{verifyWriter:true})).threadId,'thread-1')
 assert(!f.calls.some(c=>c.binary==='/usr/bin/open'));assert.equal(f.rpcs.length,1)
})
test('return only reads original metadata and requires an idle native thread',async t=>{
 const f=await adapter(t);await f.enable();await f.client.readAfterClose('thread-1');assert.deepEqual(f.rpcs[0].providerOptions.args,['app-server']);assert.equal(f.rpcs[0].codexHome,f.home)
 f.readStatus('active');await assert.rejects(f.client.readAfterClose('thread-1'),/THREAD_NOT_IDLE/)
})
test('desktop config rejects coerced booleans and arbitrary applications',()=>{
 assert.throws(()=>validateConfig('desktop',{enabled:'true',app:'ChatGPT'}),/CONFIG_INVALID_BOOLEAN/)
 assert.throws(()=>validateConfig('desktop',{enabled:true,app:'/tmp/other.app'}),/CONFIG_INVALID_VALUE/)
})
test('direct session execution cannot bypass desktop ownership',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'desktop-direct-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const manager=await new SessionManager({cwd:dir,stateDir:dir,owners:['alice'],rpcFactory:()=>{throw Error('must not connect')}}).init();t.after(()=>manager.close())
 manager.state.desktopHandoff={phase:'desktop'};await assert.rejects(manager.connect('alice',async()=>{}),/DESKTOP_EXECUTION_PAUSED/)
 await assert.rejects(manager.send({userId:'alice'},'new task'),/DESKTOP_EXECUTION_PAUSED/)
})

test('return can cancel a waiting handoff without ever launching the client',async t=>{
 const f=fixture(t);await f.service.call('alice','request_desktop_handoff',request('waiting'))
 const old=f.service.operations[0];const result=await f.service.call('alice','request_desktop_return',request('cancel-wait'))
 assert.equal(result.status,'confirmed');assert.equal(old.status,'not_executed');await f.service.run(old)
 assert(!f.events.some(e=>e.startsWith('open:')));assert.equal(f.manager.state.desktopHandoff,undefined)
})
test('mutating management calls are blocked during desktop ownership while status reads remain available',async t=>{
 const f=fixture(t);f.manager.state.desktopHandoff={owner:'alice',projectId:'1',phase:'desktop'}
 await assert.rejects(f.service.call('alice','submit_project_task',{projectId:'1',text:'work',requestId:'new-task'}),/DESKTOP_EXECUTION_PAUSED/)
 assert.equal((await f.service.call('alice','get_project_status',{projectId:'1'})).executionOwner,'desktop')
 assert.equal((await f.service.call('alice','get_desktop_status',{})).handoff.phase,'desktop')
})
test('disabling the integration does not strand a checked return',async t=>{
 const f=await adapter(t);await f.enable();await writeFile(join(f.home,'..','desktop-handoff.json'),JSON.stringify({version:1,enabled:false,app:'ChatGPT'}))
 assert.equal((await f.client.readAfterClose('thread-1')).threadId,'thread-1');assert(!f.calls.some(c=>c.binary==='/usr/bin/open'))
})

test('the original owner can safely return if account authorization changes while away',async t=>{
 const f=fixture(t);f.manager.state.desktopHandoff={owner:'alice',projectId:'1',threadId:'original-thread',workspace:null,phase:'desktop'}
 f.conversations.realOwners.add('bob')
 assert.equal((await f.service.call('alice','request_desktop_return',request('owner-return'))).status,'confirmed')
 assert.equal(f.manager.state.desktopHandoff,undefined)
})
test('unsupported platforms and custom providers cannot launch desktop access',async t=>{
 const f=await adapter(t);await f.enable()
 for(const extra of [{platform:'linux'},{platform:'darwin',providerKind:'custom'},{platform:'darwin',sqliteHome:'/different/index'}]){
  let calls=0;const client=createDesktopClient({account:{stateDir:join(f.home,'..')},codexHome:f.home,...extra,run:async()=>{calls++;return {stdout:''}}})
  await assert.rejects(client.open('thread-1'),/MANAGEMENT_DESKTOP_(PLATFORM|PROVIDER|PROFILE_LAYOUT)_UNSUPPORTED/);assert.equal(calls,0)
 }
})

test('shutdown after durable intent does not launch a new desktop instance',async t=>{
 const f=fixture(t);await f.service.call('alice','request_desktop_handoff',request('shutdown'))
 f.desktop.prepare=async()=>{f.service.closed=true}
 await f.service.run(f.service.operations[0]);assert(!f.events.some(e=>e.startsWith('open:')));assert(f.manager.state.desktopHandoff)
})
test('desktop launch rechecks the caller guard immediately before opening',async t=>{
 const f=await adapter(t);await f.enable();await assert.rejects(f.client.open('thread-1',{current:()=>false}),/LAUNCH_CANCELLED/)
 assert(!f.calls.some(c=>c.binary==='/usr/bin/open'))
})

test('legacy installation, upgrade and restart controllers cannot bypass desktop ownership',async()=>{
 const {createManagementController}=await import('../../src/interfaces/controllers/management-controller.mjs'),sent=[],acks=[]
 const denied=()=>{throw Error('must not mutate service')}
 const controller=createManagementController({manager:{state:{desktopHandoff:{phase:'desktop'}}},jobs:{acknowledge:ids=>acks.push(ids)},setupReceipts:{capture:denied},runtime:{track:denied},agentSwitcher:{handle:denied},upgrader:{handle:denied}})
 const message={_ingressId:'desktop-request'},deliver=async text=>sent.push(text)
 await controller.setup('login',message,deliver);await controller.agent('restart',message,deliver);await controller.upgrade(message,deliver)
 assert.equal(acks.length,3);assert.equal(sent.length,3);assert(sent.every(text=>text.includes('先完成并关闭桌面')))
})

test('a return racing the last launch preflight cannot reopen a cancelled handoff',async t=>{
 const f=fixture(t);await f.service.call('alice','request_desktop_handoff',request('race-open'))
 let release,entered;const started=new Promise(r=>{entered=r}),blocked=new Promise(r=>{release=r});t.after(()=>release())
 f.desktop.prepare=async()=>{entered();await blocked}
 const op=f.service.operations[0],running=f.service.run(op);await started
 const returned=await f.service.call('alice','request_desktop_return',request('race-return'));assert.equal(returned.status,'confirmed')
 release();await running;assert(!f.events.some(e=>e.startsWith('open:')));assert.equal(f.manager.state.desktopHandoff,undefined)
})
