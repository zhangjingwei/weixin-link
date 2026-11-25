import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ClaudeSession} from '../../src/infrastructure/agents/claude/session.mjs'
import {createClaudeProtocol} from '../../src/infrastructure/agents/claude/protocol.mjs'
import {claudeEnvironment} from '../../src/infrastructure/agents/claude/environment.mjs'
import {inspectClaude} from '../../src/infrastructure/agents/claude/installation.mjs'
import {agentCommand} from '../../src/setup/agent.mjs'
import {readAgentSelection} from '../../src/infrastructure/agents/agent-selection.mjs'
function harness(){
 const events=[],submitted=[],queue=[],waiting=[];let options,ending=false
 const handle={initializationResult:async()=>({models:[]}),interrupt:async()=>{},close:()=>{ending=true;waiting.shift()?.()},supportedModels:async()=>[],
  async *[Symbol.asyncIterator](){while(!ending){if(queue.length){yield queue.shift();continue}await new Promise(r=>waiting.push(r))}}}
 const query=opts=>{options=opts;void(async()=>{for await(const m of opts.prompt)submitted.push(m)})();return handle}
 const rpc=new ClaudeSession({query,binary:'/fake/claude',cwd:'/fake',onEvent:e=>events.push(e),onClose:()=>events.push({method:'closed'})})
 return {rpc,events,submitted,handle,get options(){return options},push:value=>{queue.push(value);waiting.shift()?.()}}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('multi-turn stream preserves session, returns authoritative result once and never exposes subagent or partial text',async()=>{
 const h=harness(),saved={};await h.rpc.open(saved,'rules');const first=await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'hello'}]});await flush()
 assert.equal(h.events.some(e=>e.method==='turn/started'),false)
 assert.equal(saved.agentKind,'claude');assert.equal(h.submitted[0].message.content[0].text,'hello')
 h.push({type:'assistant',session_id:h.rpc.id,uuid:'nested',parent_tool_use_id:'agent',message:{content:[{type:'text',text:'private nested'}]}})
 h.push({type:'stream_event',session_id:h.rpc.id,event:{delta:{text:'partial'}}})
 h.push({type:'result',subtype:'success',session_id:h.rpc.id,result:'answer'})
 await flush();assert.equal(h.events.filter(e=>e.method==='turn/completed').length,1);assert.equal(JSON.stringify(h.events).includes('private nested'),false);assert.equal(JSON.stringify(h.events).includes('partial'),false)
 const second=await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'follow up'}]});assert.notEqual(second.turn.id,first.turn.id);assert.equal(h.options.options.sessionId,h.rpc.id);h.rpc.close()
})
test('approval is bound to one turn and fails closed on cancellation; stop acknowledgement is not completion',async()=>{
 const h=harness();await h.rpc.open({},'');const {turn}=await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'task'}]});await flush()
 const controller=new AbortController(),pending=h.options.options.canUseTool('Bash',{command:'echo test'},{signal:controller.signal,toolUseID:'tool'})
 const request=h.events.find(e=>e.id);h.rpc.respond('foreign',{decision:'accept'});assert.equal(h.rpc.pending.size,1);h.rpc.respond(request.id,{decision:'accept'});assert.equal((await pending).behavior,'allow')
 const rejected=h.options.options.canUseTool('Write',{file_path:'/fake/test'},{signal:controller.signal});controller.abort();assert.equal((await rejected).behavior,'deny')
 await h.rpc.interrupt(h.rpc.id,turn.id);assert.equal(h.events.some(e=>e.method==='turn/completed'),false)
 h.push({type:'result',session_id:h.rpc.id,subtype:'error_during_execution'});await flush();assert.equal(h.events.at(-1).params.turn.status,'interrupted');h.rpc.close()
})
test('resume is explicit, provider mismatch is refused, disconnect remains unknown without a result',async()=>{
 const h=harness();await assert.rejects(h.rpc.open({threadId:'codex'},''),/PROVIDER_MISMATCH/)
 const saved={threadId:'retained',agentKind:'claude'};await h.rpc.open(saved,'');assert.equal(h.options.options.resume,'retained')
 const protocol=createClaudeProtocol();assert.equal(await protocol.recoverTurn(h.rpc,{threadId:'retained',turnId:'unknown'}),null)
 saved.resultIdentity={threadId:'retained',turnId:'finished',execution:'completed'};saved.lastReply='saved result'
 assert.equal((await protocol.recoverTurn(h.rpc,{threadId:'retained',turnId:'finished'})).items[0].text,'saved result');h.rpc.close()
})
test('SDK errors do not leak raw provider exception or pretend to complete',async()=>{
 const events=[],rpc=new ClaudeSession({query:()=>({initializationResult:async()=>({}),close(){},async *[Symbol.asyncIterator](){throw Error('token=secret, prompt=private')}}),binary:'/fake',cwd:'/fake',onEvent:e=>events.push(e),onClose:()=>events.push({method:'closed'})})
 await assert.rejects(rpc.open({},''),/INITIALIZATION_FAILED/);assert.deepEqual(events,[{method:'closed'}])
})
test('subscription environment and auth checks cannot silently route through an API key',async()=>{
 const env=claudeEnvironment({PATH:'safe',ANTHROPIC_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',CLAUDE_CODE_USE_BEDROCK:'1'});assert.deepEqual(env,{PATH:'safe'})
 const run=async(_binary,args)=>({stdout:args[0]==='--version'?'2.1.319 (Claude Code)':JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'private'})})
 assert.deepEqual(await inspectClaude('/fake',{run}),{version:'2.1.319',authenticated:true,authMethod:'claude.ai'})
 await assert.rejects(inspectClaude('/fake',{run:async(_,args)=>({stdout:args[0]==='--version'?'2.1.319':JSON.stringify({loggedIn:true,authMethod:'api_key'})})}),/SUBSCRIPTION_LOGIN_REQUIRED/)
})
test('selection is explicit and atomic; a running service blocks a switch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'claude-selection-'));t.after(()=>rm(dir,{recursive:true,force:true}));const account={stateDir:dir,socket:join(dir,'socket')}
 assert.equal((await readAgentSelection(dir)).kind,'codex')
 await assert.rejects(agentCommand(['select','claude','--binary','/fake/claude'],{account,probe:async()=>({})}),/SERVICE_MUST_BE_STOPPED/)
 await agentCommand(['select','claude','--binary','/fake/claude'],{account,inspect:async()=>{},probe:async()=>{throw Object.assign(Error(),{code:'ENOENT'})}})
 assert.equal((await readAgentSelection(dir)).kind,'claude')
})

test('Claude events drive the existing session engine and saved results survive a passive Mac read',async t=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs'),{macCompanion}=await import('../../src/application/conversations/mac-companion.mjs')
 const dir=await mkdtemp(join(tmpdir(),'claude-engine-')),h=harness(),output=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:createClaudeProtocol({binary:'/fake',query:h.rpc.query,inspect:async()=>{}})}).init()
 t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
 const task=manager.ask('owner',{text:'first'},async text=>{output.push(text);return {status:'accepted'}},10000)
 for(let i=0;i<30&&!h.submitted.length;i++)await new Promise(r=>setTimeout(r,5))
 const session=manager.sessions.get('owner');assert.ok(session.turnId);assert.ok(h.submitted.length)
 h.push({type:'result',session_id:session.threadId,subtype:'success',result:'Claude result'})
 assert.equal((await task).status,'completed');assert.deepEqual(output,['Claude result'])
 const view=await macCompanion({owner:'owner',access:{read:()=>({writer:'wechat'})},conversations:{ensure:()=>({active:'1',entries:[{id:'1',key:'owner',name:'Claude'}]})},manager,jobs:{companionMessages:()=>[]},stateDir:dir})({action:'view'})
 assert.equal(view.messages.at(-1).text,'Claude result');assert.equal(manager.state.users.owner.agentKind,'claude')
})

test('normalized authorized images become content blocks while unsupported audio is rejected',async t=>{
 const {writeFile}=await import('node:fs/promises'),{claudeInput,claudeContent}=await import('../../src/infrastructure/agents/claude/input.mjs')
 const dir=await mkdtemp(join(tmpdir(),'claude-image-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'test.png')
 await writeFile(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXWQAAAAASUVORK5CYII=','base64'))
 const content=await claudeContent(claudeInput({text:'read image',images:[path]}));assert.equal(content[1].source.media_type,'image/png')
 assert.throws(()=>claudeInput({text:'audio',audios:['/fake']}),/AUDIO_UNSUPPORTED/);assert.throws(()=>claudeInput({text:'bad',images:['relative.png']}),/INVALID_IMAGE_PATH/)
})

test('Claude selection mounts an isolated engine directory and never imports Codex thread state',async t=>{
 const {writeFile,readFile}=await import('node:fs/promises'),{saveAgentSelection}=await import('../../src/infrastructure/agents/agent-selection.mjs'),{loadAgentAdapter}=await import('../../src/infrastructure/agents/agent-adapter.mjs')
 const dir=await mkdtemp(join(tmpdir(),'claude-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const old=JSON.stringify({version:1,users:{owner:{threadId:'codex-thread',hasMessages:true}}});await writeFile(join(dir,'assistant-sessions.json'),old)
 await saveAgentSelection(dir,{version:1,kind:'claude',binary:'/fake/claude'})
 const agent=await loadAgentAdapter({stateDir:dir},dir,{});assert.equal(agent.backend.stateDir,join(dir,'agents','claude'));assert.equal(agent.sessionOptions.sessionProtocol.forAgent('claude').enqueue,undefined);assert.equal(agent.sessionOptions.sessionProtocol.supportsNativeCommands,false);assert.equal(agent.sessionOptions.codexHome,undefined);assert.deepEqual(agent.sessionOptions.sessionProtocol.availableAgents,['claude'])
 assert.equal(await readFile(join(dir,'assistant-sessions.json'),'utf8'),old)
})

test('late replayed result cannot finish the next user message',async()=>{
 const h=harness();await h.rpc.open({},'');await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'first'}],deliveryId:'durable-one'})
 const result={type:'result',uuid:'first-result',session_id:h.rpc.id,subtype:'success',result:'first answer'};h.push(result);await flush()
 await h.rpc.start({threadId:h.rpc.id,input:[{type:'text',text:'second'}],deliveryId:'durable-two'});const turn=h.rpc.turn
 h.push(result);await flush();assert.equal(h.rpc.turn,turn);assert.equal(h.events.filter(e=>e.method==='turn/completed').length,1)
 h.push({type:'result',uuid:'wrong',user_message_uuid:'another-user-message',session_id:h.rpc.id,subtype:'success',result:'wrong answer'});await flush();assert.equal(h.rpc.turn,turn);h.rpc.close()
})

test('a live Claude approval can be answered through the owned WeChat conversation parser',async t=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs'),{TextConversations}=await import('../../src/application/conversations/text-conversations.mjs'),{conversationInput}=await import('../../src/interfaces/wechat/conversation-command.mjs'),{createClaudeConversationBackend}=await import('../../src/infrastructure/agents/claude/conversation-backend.mjs')
 const dir=await mkdtemp(join(tmpdir(),'claude-approval-')),h=harness(),manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:createClaudeProtocol({binary:'/fake',query:h.rpc.query,inspect:async()=>{}})}).init()
 t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
 const conversations=new TextConversations(manager,['owner'],conversationInput,createClaudeConversationBackend(manager)),reply=async()=>({status:'accepted'})
 assert.equal(conversations.bind({userId:'owner',text:'批准'})._conversationCommand,null)
 const task=manager.ask('owner','task',reply,10000);for(let i=0;i<30&&!h.submitted.length;i++)await new Promise(r=>setTimeout(r,5))
 h.push({type:'stream_event',session_id:manager.sessions.get('owner').threadId});await flush()
 const permission=h.options.options.canUseTool('Bash',{command:'echo test'},{signal:new AbortController().signal,toolUseID:'tool'});await flush()
 const first=conversations.bind({userId:'owner',text:'批准'});assert.equal(first._conversationCommand.target,'approvalChoice');await conversations.control(first,reply)
 const selected=conversations.bind({userId:'owner',text:'1'});assert.equal(selected._sessionCommand.action,'approval');await manager.handle('owner',selected.text,reply,undefined,manager.lifecycle.capture('owner'),selected._sessionCommand)
 assert.equal((await permission).behavior,'allow');h.push({type:'result',session_id:manager.sessions.get('owner').threadId,subtype:'success',result:'done'});await task
})

test('missing subscription login cancels an unsubmitted task instead of replaying it',async t=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs'),{DurableJobs}=await import('../../src/infrastructure/storage/durable-jobs.mjs'),{DurableIntake}=await import('../../src/application/tasks/durable-intake.mjs')
 const dir=await mkdtemp(join(tmpdir(),'claude-no-login-')),jobs=new DurableJobs(join(dir,'inbox.sqlite')),messages=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:createClaudeProtocol({binary:'/fake',query:()=>assert.fail('must not start SDK'),inspect:async()=>{throw Object.assign(Error('CLAUDE_LOGIN_REQUIRED'),{code:'CLAUDE_LOGIN_REQUIRED'})}})}).init();manager.submissions=jobs
 const intake=new DurableIntake({jobs,manager,reply:async(_,text)=>messages.push(text)})
 t.after(async()=>{intake.close();manager.close();await manager.saving;jobs.close();await rm(dir,{recursive:true,force:true})})
 const id=intake.submit('owner',{text:'question'},'missing-login')
 for(let i=0;i<50&&jobs.get(id).state!=='cancelled';i++)await new Promise(r=>setTimeout(r,5))
 assert.equal(jobs.get(id).state,'cancelled');assert.match(messages.join(''),/本条尚未提交/);assert.equal(jobs.get(id).turn_id,null)
})
test('Claude receives the scoped management MCP bridge without inheriting arbitrary server environment',async()=>{
 const h=harness();h.rpc.management={config:{'mcp_servers.zerolink-management':{command:'/fake/node',args:['/fake/bridge']}},environment:{ZEROLINK_MANAGEMENT_SOCKET:'/private/socket',ZEROLINK_MANAGEMENT_CAPABILITY:'test-capability'}}
 await h.rpc.open({},'rules')
 assert.deepEqual(h.options.options.mcpServers['zerolink-management'],{type:'stdio',command:'/fake/node',args:['/fake/bridge'],env:h.rpc.management.environment})
 h.rpc.close()
})
test('an unsubmitted Claude identity is reused as sessionId rather than silently replaced',async()=>{
 const h=harness();await h.rpc.open({threadId:'allocated',agentKind:'claude',hasMessages:false},'rules')
 assert.equal(h.rpc.id,'allocated');assert.equal(h.options.options.sessionId,'allocated');assert.equal(h.options.options.resume,undefined);h.rpc.close()
})
