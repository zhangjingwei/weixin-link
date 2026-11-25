import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,chmod,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {discoverAgentBinaries} from '../../src/infrastructure/agents/agent-discovery.mjs'
import {loadAgentAdapter} from '../../src/infrastructure/agents/agent-adapter.mjs'
import {saveAgentSelection} from '../../src/infrastructure/agents/agent-selection.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'agent-discovery-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const bin=join(dir,'bin');await mkdir(bin)
 const executable=async name=>{const path=join(bin,name);await writeFile(path,'test fixture');await chmod(path,0o700);return path}
 return {dir,bin,executable}
}

test('startup discovers compatible optional agents and repeats after restart without rewriting selection',async t=>{
 const {dir,bin,executable}=await fixture(t),binary=await executable('codebuddy'),calls=[]
 await saveAgentSelection(dir,{version:1,kind:'claude',binary:'/explicit/claude'})
 const original=await readFile(join(dir,'agent.json'),'utf8')
 const discover=selected=>discoverAgentBinaries(selected,{env:{PATH:bin},platform:'linux',inspectors:{claude:()=>assert.fail('explicit path must not be replaced'),workbuddy:async path=>calls.push(path)}})
 for(let restart=0;restart<2;restart++){
  const adapter=await loadAgentAdapter({stateDir:dir},dir,{},{discover})
  assert.equal(adapter.kind,'claude')
  assert.deepEqual(adapter.sessionOptions.sessionProtocol.availableAgents,['workbuddy','claude'])
  assert.equal(adapter.sessionOptions.sessionProtocol.forAgent('workbuddy').createRpc({}).binary,binary)
 }
 assert.deepEqual(calls,[binary,binary])
 assert.equal(await readFile(join(dir,'agent.json'),'utf8'),original)
})

test('missing or incompatible CLI does not block startup or fall through to another PATH candidate',async t=>{
 const {bin,executable}=await fixture(t),binary=await executable('codebuddy'),calls=[]
 const result=await discoverAgentBinaries({kind:'codex'},{env:{PATH:[bin,join(bin,'missing')].join(delimiter)},platform:'linux',inspectors:{claude:()=>assert.fail('missing executable'),workbuddy:async path=>{calls.push(path);throw Error('unsupported version')}}})
 assert.deepEqual(result,{})
 assert.deepEqual(calls,[binary])
})

test('explicit registrations win even when missing; relative PATH entries and directories are ignored',async t=>{
 const {bin,executable}=await fixture(t);await executable('codebuddy');await mkdir(join(bin,'claude'))
 const inspect=()=>assert.fail('must not probe explicit paths or directories')
 const selected={kind:'workbuddy',binary:'/registered/codebuddy',claudeBinary:'/registered/claude'}
 assert.deepEqual(await discoverAgentBinaries(selected,{env:{PATH:['.',bin].join(delimiter)},inspectors:{claude:inspect,workbuddy:inspect}}),{claudeBinary:'/registered/claude',workbuddyBinary:'/registered/codebuddy'})
 assert.deepEqual(await discoverAgentBinaries({kind:'codex'},{env:{PATH:'.'},inspectors:{claude:inspect,workbuddy:inspect}}),{})
})

test('Doubao and Grok are discovered together without changing the default or account configuration',async t=>{
 const {dir,bin,executable}=await fixture(t),doubao=await executable('doubao'),grok=await executable('grok'),checked=[]
 await saveAgentSelection(dir,{version:1,kind:'claude',binary:'/explicit/claude'})
 const original=await readFile(join(dir,'agent.json'),'utf8')
 const discover=selected=>discoverAgentBinaries(selected,{env:{PATH:bin},platform:'linux',inspectors:{claude:()=>assert.fail('explicit'),workbuddy:()=>assert.fail('missing'),doubao:async binary=>checked.push(binary),grok:async binary=>checked.push(binary)}})
 const adapter=await loadAgentAdapter({stateDir:dir},dir,{},{discover})
 assert.equal(adapter.kind,'claude')
 assert.deepEqual(adapter.sessionOptions.sessionProtocol.availableAgents,['doubao','grok','claude'])
 assert.deepEqual(new Set(checked),new Set([doubao,grok]))
 assert.equal(await readFile(join(dir,'agent.json'),'utf8'),original)
})

test('a bundled installation alone never registers a user Codex executor',async t=>{
 const {dir}=await fixture(t)
 const adapter=await loadAgentAdapter({stateDir:dir},dir,{codexBinary:'/bundled/codex'},{discover:async()=>({})})
 const protocol=adapter.sessionOptions.sessionProtocol
 assert.deepEqual(protocol.availableAgents,[])
 assert.throws(()=>protocol.createRpc({agentKind:'codex'}),/AGENT_UNAVAILABLE/)
})

test('system Codex ignores the platform model profile',async t=>{
 const {dir}=await fixture(t)
 const previous=process.env.CODEX_HOME
 process.env.CODEX_HOME=join(dir,'native')
 t.after(()=>{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous})
 await writeFile(join(dir,'codex-provider.json'),JSON.stringify({version:1,kind:'kimi',model:'kimi-k3.1-pro',apiKey:'test-key-private'}),{mode:0o600})
 const adapter=await loadAgentAdapter({stateDir:dir},dir,{codexBinary:'/bundled/codex'},{discover:async()=>({codexBinary:'/system/codex'})})
 assert.equal(adapter.sessionOptions.sessionProtocol.kind,null)
 assert.equal(adapter.codexBinary,'/system/codex')
 assert.deepEqual(adapter.sessionOptions.sessionProtocol.providerOptions('codex').args,['app-server','--listen','stdio://'])
 assert.deepEqual(adapter.sessionOptions.sessionProtocol.providerOptions('codex').thread,{})
})

test('management discovers and registers a newly installed Doubao without switching the caller',async t=>{
 const {ManagementService}=await import('../../src/application/management/management-service.mjs')
 const {dir,bin,executable}=await fixture(t)
 const discover=(config,options)=>discoverAgentBinaries(config,{...options,env:{PATH:bin},platform:'linux',inspectors:{doubao:async()=>({version:'2.38.2'})}})
 const adapter=await loadAgentAdapter({stateDir:dir},dir,{},{discover})
 const manager={state:{users:{caller:{activeAgent:'claude'}}},save:async()=>{}}
 const service=new ManagementService({manager,agentRegistry:adapter.registry,conversations:{realOwners:new Set(['owner']),entry:key=>key==='caller'?{owner:'owner'}:null}})
 const call=(tool,args)=>service.call('caller',tool,args)
 const register=requestId=>call('request_agent_registration',{agentKind:'doubao',requestId})
 assert.equal((await register('before-install')).detail,'MANAGEMENT_AGENT_NOT_DETECTED')
 const path=await executable('doubao')
 const inspected=await call('list_agent_executors',{})
 assert.deepEqual(inspected.executors.find(row=>row.agentKind==='doubao'),{agentKind:'doubao',registered:false,detected:true})
 const result=await register('after-install')
 assert.equal(result.status,'confirmed')
 assert.deepEqual(await register('after-install'),result)
 assert.deepEqual(adapter.sessionOptions.sessionProtocol.availableAgents,['doubao'])
 assert.equal(manager.state.users.caller.activeAgent,'claude')
 assert.equal(JSON.parse(await readFile(join(dir,'agent.json'),'utf8')).doubaoBinary,path)
 const restarted=await loadAgentAdapter({stateDir:dir},dir,{},{discover})
 assert.deepEqual(restarted.sessionOptions.sessionProtocol.availableAgents,['doubao'])
 await assert.rejects(service.call('stranger','request_agent_registration',{agentKind:'doubao',requestId:'forbidden'}),/FORBIDDEN/)
})
