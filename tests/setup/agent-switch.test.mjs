import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {agentSwitchCommand,AgentSwitcher,readAgentSwitch,scheduleAgentSwitch} from '../../src/setup/agent-switch.mjs'
import {performAgentSwitch} from '../../src/setup/agent-switch-worker.mjs'
import {selectedAgentKind} from '../../src/infrastructure/agents/agent-selection.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'

test('agent command matches only explicit switches',()=>{
 assert.deepEqual(agentSwitchCommand('重启'),{action:'restart',target:null})
 assert.deepEqual(agentSwitchCommand('切换智能体'),{action:'agent',target:null})
 assert.deepEqual(agentSwitchCommand('/agent claude'),{action:'agent',target:'claude'})
 assert.deepEqual(agentSwitchCommand('切换智能体 Codex'),{action:'agent',target:'codex'})
 assert.equal(agentSwitchCommand('帮我切换智能体'),null)
 assert.equal(agentSwitchCommand('帮我重启'),null)
 assert.equal(agentSwitchCommand('切换智能体 OpenCode'),null)
})
test('restart schedules only the current account after the reply without changing agent selection',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-restart-command-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const account={id:'default',stateDir},sent=[],scheduled=[]
 const switcher=new AgentSwitcher({account,agentKind:'codex',installation:{agentBackend:'codex'},deployment:async()=>({services:[{id:'default',active:true}]}),schedule:async(a,request)=>scheduled.push(request),targetRoot:stateDir})
 await switcher.handle({action:'restart',target:null},value=>sent.push(value))
 assert.equal(scheduled.length,1);assert.equal(scheduled[0].target,'codex');assert.equal(scheduled[0].previous,'codex')
 assert.match(sent[0],/空闲后重启/)
 await switcher.handle({action:'restart',target:null},value=>sent.push(value))
 assert.equal(scheduled.length,1);assert.match(sent[1],/未重复安排/)
})

test('account selection remains isolated and falls back to installation default',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'agent-select-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const first={stateDir:join(dir,'one')},second={stateDir:join(dir,'two')}
 const {mkdir}=await import('node:fs/promises');await mkdir(first.stateDir);await mkdir(second.stateDir)
 assert.equal(await selectedAgentKind(first,{agentBackend:'codex'}),'codex')
 const {writeAgentKind}=await import('../../src/infrastructure/agents/agent-selection.mjs')
 await writeAgentKind(first,'claude')
 assert.equal(await selectedAgentKind(first,{agentBackend:'codex'}),'claude')
 assert.equal(await selectedAgentKind(second,{agentBackend:'codex'}),'codex')
})

test('switch command schedules one account without switching before reply',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-switch-command-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const account={id:'default',stateDir},sent=[],scheduled=[]
 const switcher=new AgentSwitcher({account,agentKind:'claude',installation:{agentBackend:'claude'},backendReady:async()=>({installed:true,loggedIn:true}),deployment:async()=>({services:[{id:'default',active:true}]}),schedule:async(a,request)=>scheduled.push(request),targetRoot:stateDir})
 await switcher.handle({action:'agent',target:'codex'},value=>sent.push(value))
 assert.equal(scheduled.length,1)
 assert.equal((await readAgentSwitch(account)).status,'waiting_idle')
 assert.equal(await selectedAgentKind(account,{agentBackend:'claude'}),'claude')
 await switcher.handle({action:'agent',target:'codex'},value=>sent.push(value))
 assert.equal(scheduled.length,1)
 assert.match(sent[1],/未重复安排/)
 assert.equal((await readFile(join(stateDir,'agent-switch.json'),'utf8')).includes('codex'),true)
})
test('concurrent switch commands schedule only one worker',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-switch-race-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const account={id:'default',stateDir},scheduled=[]
 const switcher=new AgentSwitcher({account,agentKind:'claude',installation:{agentBackend:'claude'},backendReady:async()=>({installed:true,loggedIn:true}),deployment:async()=>({services:[{id:'default',active:true}]}),schedule:async(a,request)=>scheduled.push(request),targetRoot:stateDir})
 await Promise.all([switcher.handle({target:'codex'},async()=>{}),switcher.handle({target:'codex'},async()=>{})])
 assert.equal(scheduled.length,1)
})
test('macOS switch worker is launched once without KeepAlive',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-switch-launch-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const calls=[],account={id:'default',stateDir},request={id:'11111111-2222-3333-4444-555555555555'}
 await scheduleAgentSwitch(account,request,{platform:'darwin',home:'/Users/example',run:async(...args)=>calls.push(args)})
 assert.equal(calls.length,1)
 assert.deepEqual(calls[0][1].slice(0,2),['bootstrap','gui/'+process.getuid()])
 const plist=await readFile(join(stateDir,'agent-switch-'+request.id+'.plist'),'utf8')
 assert.match(plist,/<key>RunAtLoad<\/key><true\/>/)
 assert.match(plist,/<key>KeepAlive<\/key><false\/>/)
 assert(!plist.includes('ANTHROPIC_API_KEY'))
})

function workerFixture(){
 const account={id:'default',stateDir:'/unused'},events=[]
 let kind='codex',request={id:'request-1',target:'claude',previous:'codex',status:'waiting_idle'}
 const adapter={services:[{id:'default',active:true}],status:async()=>({ready:true,idle:true,backend:{agentKind:kind}}),control:async(a,action)=>{events.push(action);return {idle:true}},stop:async()=>events.push('stop'),start:async()=>events.push('start')}
 const options={account,requestId:request.id,root:'/unused',home:'/unused',read:async()=>request,save:async(a,value)=>{request=value;events.push('save:'+value.status)},write:async(a,value)=>{kind=value;events.push('write:'+value)},deployment:async()=>adapter,wait:async()=>{},attempts:1}
 return {options,adapter,events,get kind(){return kind},get request(){return request}}
}
test('worker drains, switches only this account and verifies new backend',async()=>{
 const f=workerFixture(),result=await performAgentSwitch(f.options)
 assert.deepEqual(result,{status:'complete',agentKind:'claude'})
 assert.equal(f.kind,'claude');assert.equal(f.request.status,'complete')
 assert.deepEqual(f.events,['drain','seal','save:committing','stop','write:claude','start','save:complete'])
})
test('worker refuses to leave a backend with unresolved account tasks',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-switch-queue-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const f=workerFixture();f.options.account.stateDir=stateDir
 const jobs=new DurableJobs(join(stateDir,'inbox.sqlite'));const id=jobs.add('owner',{text:'pending'},'pending');jobs.close()
 await assert.rejects(performAgentSwitch(f.options),/AGENT_SWITCH_QUEUE_UNRESOLVED/)
 assert.deepEqual(f.events,['drain','seal','resume','save:failed'])
 const resumed=new DurableJobs(join(stateDir,'inbox.sqlite'));resumed.mark(id,'done');resumed.close()
 f.events.length=0;f.options.read=async()=>({...f.request,status:'waiting_idle'})
 await performAgentSwitch(f.options)
 assert(f.events.includes('stop'))
})
test('worker rolls back selection when new backend fails health check',async()=>{
 const f=workerFixture()
 f.adapter.status=async()=>({ready:f.kind==='codex',idle:true,backend:{agentKind:f.kind}})
 await assert.rejects(performAgentSwitch(f.options),/AGENT_SWITCH_HEALTH_CHECK_FAILED/)
 assert.equal(f.kind,'codex');assert.equal(f.request.status,'failed')
 assert.deepEqual(f.events.slice(-4),['stop','write:codex','start','save:failed'])
})
test('restart worker requires a new runtime instance and leaves agent selection unchanged',async()=>{
 const f=workerFixture()
 let request={id:'restart-1',target:'codex',previous:'codex',status:'waiting_idle'},instance='before'
 f.options.requestId=request.id;f.options.read=async()=>request;f.options.save=async(a,value)=>{request=value;f.events.push('save:'+value.status)}
 f.options.write=async()=>{throw Error('must not rewrite selection')}
 f.adapter.status=async()=>({ready:true,idle:true,instance,backend:{agentKind:'codex'}})
 f.adapter.start=async()=>{f.events.push('start');instance='after'}
 const result=await performAgentSwitch(f.options)
 assert.equal(result.status,'complete');assert.equal(request.status,'complete')
 assert.deepEqual(f.events,['drain','seal','save:committing','stop','start','save:complete'])
})
