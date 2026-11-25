import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DoubaoSession} from '../../src/infrastructure/agents/doubao/session.mjs'
import {GrokSession} from '../../src/infrastructure/agents/grok/session.mjs'
import {inspectDoubao} from '../../src/infrastructure/agents/doubao/installation.mjs'
import {inspectGrok} from '../../src/infrastructure/agents/grok/installation.mjs'
import {doubaoEnvironment} from '../../src/infrastructure/agents/doubao/environment.mjs'
import {grokEnvironment} from '../../src/infrastructure/agents/grok/environment.mjs'
import {createDoubaoProtocol} from '../../src/infrastructure/agents/doubao/protocol.mjs'
import {createGrokProtocol} from '../../src/infrastructure/agents/grok/protocol.mjs'
import {agentCommand} from '../../src/setup/agent.mjs'
import {readAgentSelection} from '../../src/infrastructure/agents/agent-selection.mjs'

function harness(kind,{loadSession=true,authMethods=[{id:'cached_token'}],stopReason='end_turn'}={}){
 const events=[],calls=[],responses=[];let config,finish
 const Session=kind==='doubao'?DoubaoSession:GrokSession
 const rpc=new Session({binary:'/fake/'+kind,cwd:'/isolated',env:{HOME:'/isolated',PATH:'/bin',XAI_API_KEY:'secret',ARK_API_KEY:'secret',ANTHROPIC_API_KEY:'secret'},management:{config:{'mcp_servers.zerolink-management':{command:'/node',args:['/management.mjs']}},environment:{ZEROLINK_MANAGEMENT_CAPABILITY:'scoped-only'}},onEvent:async event=>events.push(event),onClose:()=>{},transportFactory:options=>{
  config=options
  return {async call(method,params){calls.push({method,params});if(method==='initialize')return {protocolVersion:1,authMethods,agentCapabilities:{loadSession,promptCapabilities:{image:false}}};if(method==='authenticate')return {};if(method==='session/new'||method==='session/load')return {sessionId:params.sessionId??kind+'-native',models:{currentModelId:'native-model',availableModels:[{modelId:'native-model'}]}};if(method==='session/prompt')return new Promise(resolve=>{finish=()=>resolve({stopReason})})},notify:(method,params)=>calls.push({method,params}),respond:(id,result)=>responses.push({id,result}),reject:()=>{},close(){}}
 }})
 return {rpc,events,calls,responses,config:()=>config,finish:async()=>{finish();await new Promise(resolve=>setImmediate(resolve))},update:async(update,sessionId=rpc.id)=>config.onNotification({method:'session/update',params:{sessionId,update}})}
}

for(const kind of ['doubao','grok']){
 test(`${kind} ACP preserves identity, scoped MCP and instructions, then uses authoritative completion`,async()=>{
  const h=harness(kind),saved={threadId:kind+'-saved',agentKind:kind}
  await h.rpc.open(saved,'trusted integration instructions')
  assert.equal(h.rpc.id,kind+'-saved');assert.equal(h.calls.some(c=>c.method==='session/new'),false)
  assert.equal(h.config().env.XAI_API_KEY,undefined);assert.equal(h.config().env.ARK_API_KEY,undefined)
  assert(!JSON.stringify(h.config()).includes('scoped-only'))
  assert.equal(h.calls.find(c=>c.method==='session/load').params.mcpServers[0].env[0].value,'scoped-only')
  const {turn}=await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'verify without changes'}]})
  assert.equal(h.calls.at(-1).params.prompt[0].text,'trusted integration instructions')
  await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'foreign'}},'another-session')
  await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'verified'}})
  await h.finish()
  assert.equal(h.events.filter(e=>e.method==='turn/completed').length,1)
  assert.equal(h.events.find(e=>e.method==='turn/completed').params.turn.status,'completed')
  assert.equal(h.events.find(e=>e.method==='item/completed').params.item.text,'verified')
  assert.equal(h.events.find(e=>e.method==='turn/completed').params.turn.id,turn.id)
  h.rpc.close()
 })
 test(`${kind} refuses unconfirmed recovery and unsupported image/model before inference`,async()=>{
  const noResume=harness(kind,{loadSession:false})
  await assert.rejects(noResume.rpc.open({threadId:'old',agentKind:kind},''),/RESUME_UNSUPPORTED/)
  assert.equal(noResume.calls.some(c=>c.method==='session/new'),false)
  const h=harness(kind);await h.rpc.open({},'')
  await assert.rejects(h.rpc.start({threadId:h.rpc.id,input:[{type:'localImage',path:'/never-read.png'}]}),/IMAGE_UNSUPPORTED/)
  await assert.rejects(h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'hi'}],model:'invented'}),/MODEL_UNAVAILABLE/)
  assert.equal(h.calls.some(c=>c.method==='session/prompt'),false);h.rpc.close()
 })
 test(`${kind} permission remains owned and once-only; cancel and unknown completion are not success`,async()=>{
  const h=harness(kind,{stopReason:'unexpected'});await h.rpc.open({},'');const {turn}=await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'work'}]})
  await h.config().onRequest({id:1,method:'session/request_permission',params:{sessionId:'foreign',options:[{kind:'allow_once',optionId:'once'}]}})
  assert.equal(h.responses[0].result.outcome.outcome,'cancelled')
  await h.config().onRequest({id:2,method:'session/request_permission',params:{sessionId:h.rpc.id,toolCall:{title:'read file'},options:[{kind:'allow_always',optionId:'always'},{kind:'allow_once',optionId:'once'},{kind:'reject_once',optionId:'no'}]}})
  const approval=h.events.find(e=>e.method==='item/commandExecution/requestApproval')
  h.rpc.respond(approval.id,{decision:'accept'});assert.equal(h.responses[1].result.outcome.optionId,'once')
  await assert.rejects(h.rpc.interrupt('foreign',turn.id),/STALE_TURN/)
  assert.deepEqual(await h.rpc.interrupt(h.rpc.id,turn.id),{requested:true})
  await h.finish();assert.equal(h.rpc.closed,true);assert.equal(h.events.some(e=>e.method==='turn/completed'),false)
 })
}

test('Grok only uses advertised cached login; missing auth never invokes interactive login or submits a prompt',async()=>{
 const h=harness('grok',{authMethods:[{id:'grok.com'}]})
 await assert.rejects(h.rpc.open({},''),/GROK_LOGIN_REQUIRED/)
 assert.deepEqual(h.calls.map(c=>c.method),['initialize'])
 const cached=harness('grok');await cached.rpc.open({},'')
 assert.deepEqual(cached.calls.find(c=>c.method==='authenticate').params,{methodId:'cached_token',_meta:{headless:true}});cached.rpc.close()
})

test('versions are pinned and API credentials are not inherited by optional CLI adapters',async()=>{
 for(const [inspect,env,version] of [[inspectDoubao,doubaoEnvironment,'doubao 2.38.2'],[inspectGrok,grokEnvironment,'grok 1.0.92 (test)']]){
  const checked=await inspect('/fake',{run:async(_binary,args,options)=>{assert.deepEqual(args,['--version']);assert.equal(options.env.XAI_API_KEY,undefined);return {stdout:version}},env:{HOME:'/isolated',XAI_API_KEY:'secret'}})
  assert.equal(checked.authentication,'not_checked')
  await assert.rejects(inspect('/fake',{run:async()=>({stdout:'999.0.0'})}),/VERSION_UNSUPPORTED/)
  assert.deepEqual(env({HOME:'/isolated',DOUBAO_API_KEY:'secret',XAI_API_KEY:'secret',OPENAI_API_KEY:'secret',GROK_DEPLOYMENT_KEY:'secret'}),{HOME:'/isolated'})
 }
 assert.throws(()=>createDoubaoProtocol().input({text:'hi',audios:['/audio']}),/DOUBAO_AUDIO_UNSUPPORTED/)
 assert.throws(()=>createGrokProtocol().input({text:'hi',audios:['/audio']}),/GROK_AUDIO_UNSUPPORTED/)
})

test('offline registration/default selection preserve all optional paths; online writes are blocked',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'new-agent-register-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const options={account:{stateDir:dir,socket:join(dir,'control')},inspectDoubaoCli:async()=>{},inspectGrokCli:async()=>{},probe:async()=>{throw Object.assign(Error(),{code:'ENOENT'})}}
 await agentCommand(['configure','doubao','--binary','/fake/doubao'],options)
 await agentCommand(['configure','grok','--binary','/fake/grok'],options)
 assert.equal((await readAgentSelection(dir)).kind,'codex')
 await agentCommand(['select','grok','--binary','/fake/grok'],options)
 await agentCommand(['select','codex'],options)
 assert.deepEqual(await readAgentSelection(dir),{version:1,kind:'codex',doubaoBinary:'/fake/doubao',grokBinary:'/fake/grok'})
 await assert.rejects(agentCommand(['configure','doubao','--binary','/changed'],{...options,probe:async()=>({})}),/SERVICE_MUST_BE_STOPPED/)
})

for(const kind of ['doubao','grok']){
 test(`${kind} session engine delivers ACP results and preserves the native binding`,async t=>{
  const {SessionManager}=await import('../../src/wechat/session-manager.mjs')
  const dir=await mkdtemp(join(tmpdir(),kind+'-engine-')),h=harness(kind),output=[]
  const protocol=(kind==='doubao'?createDoubaoProtocol:createGrokProtocol)({binary:'/fake',inspect:async()=>{}})
  protocol.createRpc=options=>{Object.assign(h.rpc,options);return h.rpc}
  const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:protocol}).init()
  t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
  const task=manager.ask('owner',{text:'verify'},async text=>{output.push(text);return {status:'accepted'}},10000)
  for(let i=0;i<100&&!h.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,5))
  assert(h.calls.some(c=>c.method==='session/prompt'))
  await h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:kind+' verified'}});await h.finish()
  const result=await task
  assert.equal(result.status,'completed');assert.notEqual(result.taskOutcome,'completed')
  assert.deepEqual(output,[kind+' verified']);assert.equal(manager.state.users.owner.agentKind,kind)
  assert.equal(manager.state.users.owner.threadId,kind+'-native')
 })
 test(`${kind} missing login cancels only the unsubmitted task and never retries inference`,async t=>{
  const {SessionManager}=await import('../../src/wechat/session-manager.mjs')
  const {DurableJobs}=await import('../../src/infrastructure/storage/durable-jobs.mjs')
  const {DurableIntake}=await import('../../src/application/tasks/durable-intake.mjs')
  const dir=await mkdtemp(join(tmpdir(),kind+'-login-')),jobs=new DurableJobs(join(dir,'queue.sqlite')),messages=[]
  const protocol=(kind==='doubao'?createDoubaoProtocol:createGrokProtocol)({binary:'/fake',inspect:async()=>{throw Object.assign(Error(kind.toUpperCase()+'_LOGIN_REQUIRED'),{code:kind.toUpperCase()+'_LOGIN_REQUIRED'})}})
  protocol.createRpc=()=>({closed:false,close(){this.closed=true}})
  const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:protocol}).init();manager.submissions=jobs
  const intake=new DurableIntake({jobs,manager,reply:async(_,text)=>messages.push(text)})
  t.after(async()=>{intake.close();manager.close();await manager.saving;jobs.close();await rm(dir,{recursive:true,force:true})})
  const id=intake.submit('owner',{text:'must not execute'},'login-failure')
  await intake.users.get('owner')
  assert.equal(jobs.get(id).state,'cancelled');assert.equal(jobs.get(id).turn_id,null)
  assert.match(messages.join(''),/本条尚未提交/)
  assert.equal(jobs.pending().length,0)
 })
 test(`${kind} persisted IDs stay outside Codex native controls after switching back`,async()=>{
  const {nativeControl}=await import('../../src/application/management/native-controls.mjs')
  for(const saved of [{activeAgent:kind,threadId:'native'},{activeAgent:'codex',threadId:'codex',nativeSessions:{[kind]:{threadId:'native'}}}]){
   const context={manager:{state:{users:{owner:saved}},sessions:new Map()},conversations:{realOwners:new Set(['owner']),recipient:key=>key,withBackend:()=>assert.fail('must not send non-Codex ID to Codex')}}
   await assert.rejects(nativeControl(context,'owner','owner','get_thread_goal',{threadId:'native'}),/MANAGEMENT_UNSUPPORTED/)
  }
 })
}
