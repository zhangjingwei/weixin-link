import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkbuddySession} from '../../src/infrastructure/agents/workbuddy/session.mjs'
import {AcpTransport} from '../../src/infrastructure/agents/workbuddy/transport.mjs'
import {workbuddyEnvironment} from '../../src/infrastructure/agents/workbuddy/environment.mjs'
import {inspectWorkbuddy} from '../../src/infrastructure/agents/workbuddy/installation.mjs'
import {workbuddyInput} from '../../src/infrastructure/agents/workbuddy/input.mjs'
import {createWorkbuddyProtocol} from '../../src/infrastructure/agents/workbuddy/protocol.mjs'
import {agentCommand} from '../../src/setup/agent.mjs'
import {readAgentSelection} from '../../src/infrastructure/agents/agent-selection.mjs'
const tick=()=>new Promise(r=>setImmediate(r))
function harness(overrides={}){
 const events=[],calls=[],responses=[];let wire,options,resolvePrompt,rejectPrompt,closed=0
 const rpc=new WorkbuddySession({binary:'/fake/codebuddy',cwd:'/repo',onEvent:e=>events.push(e),onClose:()=>closed++,transportFactory:o=>{
  options=o;wire={call:async(method,params)=>{calls.push({method,params});if(overrides[method])return overrides[method](params,o);if(method==='initialize')return {protocolVersion:1,agentCapabilities:{loadSession:true}};if(method==='session/new'||method==='session/load')return {sessionId:params.sessionId??'native-workbuddy',models:{currentModelId:'m1',availableModels:[{modelId:'m1',name:'Native model'}]}};if(method==='session/prompt')return new Promise((resolve,reject)=>{resolvePrompt=resolve;rejectPrompt=reject})},notify:(...a)=>calls.push(a),respond:(...a)=>responses.push(a),reject:id=>responses.push({rejected:id}),close:()=>o.onClose()};return wire
 }})
 return {rpc,events,calls,responses,get closed(){return closed},get options(){return options},finish:result=>resolvePrompt(result),fail:()=>rejectPrompt(Error('secret upstream payload')),update:async(update,extra={})=>{await options.onNotification({method:'session/update',params:{sessionId:rpc.id,update,...extra}})},request:m=>options.onRequest(m)}
}
test('ACP stream produces a single main answer from typed events, preserves native identity and ignores replay/child output',async()=>{
 const h=harness({'session/load':async(p,o)=>{await o.onNotification({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old replay'}}}});return {sessionId:p.sessionId}}})
 await h.rpc.open({threadId:'existing',agentKind:'workbuddy'},'rules');assert.equal(h.events.length,0)
 assert.equal(h.calls[1].method,'session/load');assert.equal(h.calls[1].params.sessionId,'existing')
 const {turn}=await h.rpc.start({threadId:'existing',input:workbuddyInput('hi')});assert.equal(h.events.length,0)
 await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hidden'}},{_meta:{'codebuddy.ai/memberEvent':true}})
 await h.update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private thought'}})
 await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Checking.'}})
 await h.update({sessionUpdate:'tool_call',toolCallId:'tool',kind:'read',status:'in_progress'})
 await h.update({sessionUpdate:'tool_call_update',toolCallId:'tool',status:'completed'})
 await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Done.'}})
 h.finish({stopReason:'end_turn'});await tick()
 const answers=h.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='agentMessage')
 assert.deepEqual(answers.map(e=>[e.params.item.phase,e.params.item.text]),[['commentary','Checking.'],['final_answer','Done.']])
 assert.equal(h.events.filter(e=>e.method==='turn/completed').length,1);assert.equal(h.events.at(-1).params.turn.id,turn.id)
 assert.equal(h.rpc.phase,'idle');h.rpc.close()
})
test('permission uses exact offered once-only IDs, ownership and turn binding; cancellation is only requested',async()=>{
 const h=harness();await h.rpc.open({},'');const {turn}=await h.rpc.start({threadId:h.rpc.id,input:workbuddyInput('run')})
 await h.request({id:10,method:'session/request_permission',params:{sessionId:'other',options:[]}})
 assert.deepEqual(h.responses[0],[10,{outcome:{outcome:'cancelled'}}])
 await h.request({id:11,method:'session/request_permission',params:{sessionId:h.rpc.id,toolCall:{toolCallId:'t',title:'Read file'},options:[{kind:'allow_always',optionId:'never'},{kind:'allow_once',optionId:'once'},{kind:'reject_once',optionId:'deny'}]}})
 const approval=h.events.find(e=>e.id);h.rpc.respond(approval.id,{decision:'accept'});h.rpc.respond(approval.id,{decision:'accept'})
 assert.deepEqual(h.responses[1],[11,{outcome:{outcome:'selected',optionId:'once'}}]);assert.equal(h.responses.length,2)
 assert.deepEqual(await h.rpc.interrupt(h.rpc.id,turn.id),{requested:true});assert.equal(h.events.some(e=>e.method==='turn/completed'),false)
 h.finish({stopReason:'cancelled'});await tick();assert.equal(h.events.at(-1).params.turn.status,'interrupted');h.rpc.close()
})
test('limits/refusal fail authoritatively; unknown stop and broken transport never claim success or rerun',async()=>{
 for(const stopReason of ['max_tokens','max_turn_requests','refusal','new_unknown_reason',null]){
  const h=harness();await h.rpc.open({},'');await h.rpc.start({threadId:h.rpc.id,input:workbuddyInput('go')});h.finish({stopReason});await tick()
  assert.equal(h.events.some(e=>e.params.turn?.status==='completed'),false)
  if(['refusal','max_tokens','max_turn_requests'].includes(stopReason))assert.equal(h.events.at(-1).params.turn.status,'failed')
  else assert.equal(h.rpc.phase,'unknown');h.rpc.close()
 }
 const h=harness();await h.rpc.open({},'');await h.rpc.start({threadId:h.rpc.id,input:workbuddyInput('go')});h.fail();await tick()
 assert.equal(h.closed,1);assert.equal(h.rpc.phase,'unknown');assert.equal(h.calls.filter(c=>c.method==='session/prompt').length,1)
 assert.equal(JSON.stringify(h.events).includes('secret'),false)
})
test('MCP management capability is passed only via session parameters, never inherited routing or argv',async()=>{
 const h=harness();h.rpc.management={config:{'mcp_servers.zerolink-management':{command:'/node',args:['/bridge']}},environment:{CAPABILITY:'private-test'}}
 await h.rpc.open({},'rules');assert.equal(h.options.args.join(' ').includes('private-test'),false)
 assert.deepEqual(h.calls[1].params.mcpServers,[{name:'zerolink-management',command:'/node',args:['/bridge'],env:[{name:'CAPABILITY',value:'private-test'}]}])
 assert.deepEqual(workbuddyEnvironment({HOME:'/home',PATH:'/bin',CODEBUDDY_API_KEY:'secret',ANTHROPIC_API_KEY:'secret',OPENAI_API_KEY:'secret',CODEBUDDY_CONFIG_DIR:'/config',WORKBUDDY_AUTH_SESSION:'secret'}),{HOME:'/home',PATH:'/bin',CODEBUDDY_CONFIG_DIR:'/config',DISABLE_AUTOUPDATER:'1',CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS:'1'})
 h.rpc.close()
})
test('no fallback session on failed load or unavailable resume; model list comes from native advertisement',async()=>{
 const h=harness({'initialize':()=>({protocolVersion:1,agentCapabilities:{}})})
 await assert.rejects(h.rpc.open({threadId:'old',agentKind:'workbuddy'},''),/RESUME_UNSUPPORTED/);assert.equal(h.calls.some(c=>c.method==='session/new'),false)
 const other=harness({'session/load':()=>{throw Error('unavailable')}});await assert.rejects(other.rpc.open({threadId:'old',agentKind:'workbuddy'},''));assert.equal(other.calls.some(c=>c.method==='session/new'),false)
 const ok=harness();await ok.rpc.open({},'');assert.deepEqual((await createWorkbuddyProtocol().listModels(ok.rpc)).models.map(m=>m.model),['m1'])
 await assert.rejects(ok.rpc.start({threadId:ok.rpc.id,input:workbuddyInput('go'),model:'invented'}),/MODEL_UNAVAILABLE/);ok.rpc.close()
})
test('transport bounds framing, drops raw errors, handles EOF and rejects unsupported client requests',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};let closed=0;const writes=[];child.stdin.on('data',d=>writes.push(JSON.parse(d)))
 const rpc=new AcpTransport({spawnProcess:()=>child,onClose:()=>closed++})
 const login=rpc.call('session/new',{});child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'private token'}})+'\n')
 await assert.rejects(login,e=>e.code==='WORKBUDDY_LOGIN_REQUIRED'&&!e.message.includes('private'))
 const pending=rpc.call('session/prompt',{}, {timeout:0});child.stdout.end();await assert.rejects(pending,/CONNECTION_LOST/);assert.equal(closed,1)
 const second=new EventEmitter();second.stdout=new PassThrough();second.stderr=new PassThrough();second.stdin=new PassThrough();second.kill=()=>{};const bounded=new AcpTransport({spawnProcess:()=>second});second.stdout.write('x'.repeat(32*1024*1024+1));assert.equal(bounded.closed,true)
})
test('version pin, offline registration and default reselection preserve every backend; online service blocks writes',async t=>{
 assert.deepEqual(await inspectWorkbuddy('/cli',{run:async()=>({stdout:'2.187.0 (CodeBuddy)'})}),{version:'2.187.0',authentication:'not_checked'})
 await assert.rejects(inspectWorkbuddy('/cli',{run:async()=>({stdout:'3.0.0'})}),/VERSION_UNSUPPORTED/)
 const dir=await mkdtemp(join(tmpdir(),'workbuddy-register-'));t.after(()=>rm(dir,{recursive:true,force:true}));const opts={account:{stateDir:dir,socket:'/socket'},inspect:async()=>{},inspectWorkbuddyCli:async()=>{},probe:async()=>{throw Object.assign(Error(),{code:'ENOENT'})}}
 await agentCommand(['configure','claude','--binary','/claude'],opts);await agentCommand(['configure','workbuddy','--binary','/codebuddy'],opts)
 assert.deepEqual(await readAgentSelection(dir),{version:1,kind:'codex',claudeBinary:'/claude',workbuddyBinary:'/codebuddy'})
 await agentCommand(['select','workbuddy','--binary','/codebuddy'],opts);assert.equal((await readAgentSelection(dir)).binary,'/codebuddy')
 await agentCommand(['select','codex'],opts);assert.equal((await readAgentSelection(dir)).workbuddyBinary,'/codebuddy')
 await assert.rejects(agentCommand(['configure','workbuddy','--binary','/new'],{...opts,probe:async()=>({})}),/SERVICE_MUST_BE_STOPPED/)
})
test('real session engine consumes ACP events and Mac reads the same saved result without acquiring control',async t=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs'),{macCompanion}=await import('../../src/application/conversations/mac-companion.mjs')
 const dir=await mkdtemp(join(tmpdir(),'workbuddy-engine-')),h=harness(),output=[]
 const protocol=createWorkbuddyProtocol({binary:'/fake',inspect:async()=>{}})
 protocol.createRpc=options=>{Object.assign(h.rpc,options);return h.rpc}
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:protocol}).init()
 t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
 const task=manager.ask('owner',{text:'hi'},async text=>{output.push(text);return {status:'accepted'}},10000)
 for(let i=0;i<100&&!h.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,5))
 assert.ok(manager.sessions.get('owner').turnId)
 await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'WorkBuddy answer'}});h.finish({stopReason:'end_turn'})
 const result=await task;assert.equal(result.status,'completed');assert.notEqual(result.taskOutcome,'completed');assert.deepEqual(output,['WorkBuddy answer'])
 const view=await macCompanion({owner:'owner',access:{read:()=>({writer:'wechat'})},conversations:{ensure:()=>({active:'1',entries:[{id:'1',key:'owner',name:'WorkBuddy'}]})},manager,jobs:{companionMessages:()=>[]},stateDir:dir})({action:'view'})
 assert.equal(view.messages.at(-1).text,'WorkBuddy answer');assert.equal(manager.state.users.owner.agentKind,'workbuddy')
})
test('persisted WorkBuddy IDs cannot reach Codex native controls after idle release or after switching back',async()=>{
 const {nativeControl}=await import('../../src/application/management/native-controls.mjs')
 for(const saved of [{activeAgent:'workbuddy',threadId:'native'},{activeAgent:'codex',threadId:'codex',nativeSessions:{workbuddy:{threadId:'native'}}}]){
  const context={manager:{state:{users:{owner:saved}},sessions:new Map()},conversations:{realOwners:new Set(['owner']),recipient:k=>k,withBackend:()=>assert.fail('ACP identity must never go to Codex')}}
  await assert.rejects(nativeControl(context,'owner','owner','get_thread_goal',{threadId:'native'}),/MANAGEMENT_UNSUPPORTED/)
 }
})
