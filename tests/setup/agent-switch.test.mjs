import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {agentSwitchCommand,AgentSwitcher,readAgentSwitch,scheduleAgentSwitch} from '../../src/setup/agent-switch.mjs'
import {performAgentSwitch} from '../../src/setup/agent-switch-worker.mjs'

test('only the restart command is accepted',()=>{
 assert.deepEqual(agentSwitchCommand('重启'),{action:'restart',target:null})
 for(const value of ['切换智能体','切换智能体 Codex','切换智能体 X','/agent X'])assert.equal(agentSwitchCommand(value),null)
})

test('restart schedules only the current account once',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-restart-command-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const account={id:'default',stateDir},sent=[],scheduled=[]
 const switcher=new AgentSwitcher({account,deployment:async()=>({services:[{id:'default',active:true}]}),schedule:async(a,request)=>scheduled.push(request),targetRoot:stateDir})
 await switcher.handle({action:'restart'},value=>sent.push(value))
 assert.equal(scheduled.length,1)
 assert.equal(scheduled[0].target,'codex')
 assert.equal(scheduled[0].previous,'codex')
 assert.match(sent[0],/空闲后重启/)
 await switcher.handle({action:'restart'},value=>sent.push(value))
 assert.equal(scheduled.length,1)
 assert.match(sent[1],/未重复安排/)
})

test('obsolete backend switch request is ignored',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-restart-legacy-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const account={id:'default',stateDir}
 const {writeFile}=await import('node:fs/promises')
 await writeFile(join(stateDir,'agent-switch.json'),JSON.stringify({id:'old',target:'other',previous:'codex',status:'waiting_idle'}))
 assert.equal(await readAgentSwitch(account),null)
 await assert.rejects(performAgentSwitch({account,requestId:'old'}),/AGENT_SWITCH_REQUEST_CHANGED/)
})

test('macOS restart worker is launched once without KeepAlive',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'agent-restart-launch-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const calls=[],account={id:'default',stateDir},request={id:'11111111-2222-3333-4444-555555555555'}
 await scheduleAgentSwitch(account,request,{platform:'darwin',home:'/Users/example',run:async(...args)=>calls.push(args)})
 assert.equal(calls.length,1)
 const plist=await readFile(join(stateDir,'agent-switch-'+request.id+'.plist'),'utf8')
 assert.match(plist,/<key>RunAtLoad<\/key><true\/>/)
 assert.match(plist,/<key>KeepAlive<\/key><false\/>/)
})

test('restart worker drains and requires a new runtime instance',async()=>{
 const account={id:'default',stateDir:'/unused'},events=[]
 let request={id:'restart-1',target:'codex',previous:'codex',status:'waiting_idle'},instance='before'
 const adapter={services:[{id:'default',active:true}],status:async()=>({ready:true,idle:true,instance,backend:{agentKind:'codex'}}),control:async(a,action)=>{events.push(action);return {idle:true}},stop:async()=>events.push('stop'),start:async()=>{events.push('start');instance='after'}}
 const result=await performAgentSwitch({account,requestId:request.id,read:async()=>request,save:async(a,value)=>{request=value;events.push('save:'+value.status)},deployment:async()=>adapter,wait:async()=>{},attempts:1})
 assert.equal(result.status,'complete')
 assert.deepEqual(events,['drain','seal','save:committing','stop','start','save:complete'])
})
