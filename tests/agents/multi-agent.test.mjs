import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {activeAgent,syncNativeSession,selectNativeSession,nativeThreadIds} from '../../src/domain/conversations/native-sessions.mjs'
import {createMultiAgentProtocol} from '../../src/infrastructure/agents/multi-agent-protocol.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {requestAgentSwitch} from '../../src/application/management/agent-management.mjs'
import {macCompanion} from '../../src/application/conversations/mac-companion.mjs'
import {agentCommand} from '../../src/setup/agent.mjs'
import {readAgentSelection} from '../../src/infrastructure/agents/agent-selection.mjs'
const tick=()=>new Promise(r=>setTimeout(r,5))
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick()}assert.fail('timed out')}
function protocol(kind,starts){return {kind,name:kind,supportsNativeCommands:kind==='codex',providerOptions:()=>({thread:{},args:[]}),workspaceRules:async()=>'',input:i=>[{type:'text',text:i.text}],eventCode:()=>null,cleanOutputText:t=>t,
 createRpc:options=>({...options,closed:false,close(){this.closed=true}}),initialize:async()=>{},open:async(rpc,{saved})=>({thread:{id:saved.threadId??kind+'-native'},model:kind+'-model'}),
 startTurn:async(rpc,options)=>{const turnId=kind+'-'+starts.length;starts.push({rpc,options,turnId});return {turn:{id:turnId}}},read:async(rpc,id)=>({id,cwd:rpc.cwd,status:{type:'idle'}})}}
async function fixture(t,bound=true){
 const dir=await mkdtemp(join(tmpdir(),'native-links-')),starts=[],mux=createMultiAgentProtocol({codex:protocol('codex',starts),claude:protocol('claude',starts),workbuddy:protocol('workbuddy',starts),doubao:protocol('doubao',starts),grok:protocol('grok',starts)})
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],sessionProtocol:mux}).init(),jobs=new DurableJobs(join(dir,'queue.sqlite'))
 if(bound)manager.state.users.owner={activeAgent:'codex'}
 manager.submissions=jobs
 const intake=new DurableIntake({manager,jobs,reply:async()=>({status:'accepted'})})
 t.after(async()=>{intake.close();manager.close();await manager.saving;jobs.close();await rm(dir,{recursive:true,force:true})})
 const finish=async n=>{const s=starts[n],session=manager.sessions.get('owner'),job=jobs.get(session.taskId);jobs.context(job.id,{...job.context,control:{taskId:job.id,threadId:session.threadId,turnId:session.turnId,outcome:'completed'}});await s.rpc.onEvent({method:'item/completed',params:{threadId:s.options.threadId,turnId:s.turnId,item:{id:'answer-'+n,type:'agentMessage',phase:'final_answer',text:'answer '+n}}});await s.rpc.onEvent({method:'turn/completed',params:{threadId:s.options.threadId,turn:{id:s.turnId,status:'completed'}}})}
 return {dir,starts,mux,manager,jobs,intake,finish}
}
test('legacy identity migrates; switching back preserves models, project and thread without crossing logical owners',()=>{
 const record={activeAgent:'codex',threadId:'old-codex',hasMessages:true,nativeProjectId:'project',modelOverride:'gpt',workspace:'/repo',seen:['receipt']}
 syncNativeSession(record);selectNativeSession(record,'claude');assert.equal(record.threadId,undefined);assert.equal(record.nativeProjectId,undefined)
 Object.assign(record,{threadId:'new-claude',hasMessages:true,modelOverride:'sonnet'});selectNativeSession(record,'codex')
 assert.equal(record.threadId,'old-codex');assert.equal(record.modelOverride,'gpt');assert.equal(record.nativeProjectId,'project');assert.deepEqual(record.seen,['receipt'])
 assert.deepEqual(nativeThreadIds(record),['old-codex','new-claude']);assert.equal(activeAgent({agentKind:'claude'}),'claude');assert.deepEqual(nativeThreadIds({threadId:'other'}),['other'])
})
test('connections route immutably, unsupported native operations fail closed',async()=>{
 const starts=[],mux=createMultiAgentProtocol({codex:protocol('codex',starts),claude:protocol('claude',starts),workbuddy:protocol('workbuddy',starts),doubao:protocol('doubao',starts),grok:protocol('grok',starts)}),rpc=mux.createRpc({agentKind:'claude'})
 assert.equal((await mux.open(rpc,{saved:{}})).thread.id,'claude-native');assert.throws(()=>mux.goal(rpc,'x',{}),/UNSUPPORTED/);assert.throws(()=>mux.createRpc({agentKind:'missing'}),/UNAVAILABLE/)
})
test('durable follow-up waits for source, restores both native sessions, and Mac keeps shared history on reopen',async t=>{
 const f=await fixture(t),{manager,intake,starts,jobs}=f
 const first=intake.submit('owner',{text:'first'},'first');await until(()=>starts.length===1)
 await assert.rejects(manager.selectAgent('owner','claude'),/BLOCKED/)
 const second=intake.submit('owner',{text:'原方案不好，请重新核实',agentKind:'claude',internalHandoff:true,dependencies:[first]},'switch')
 await tick();assert.equal(starts.length,1);assert.equal(manager.agentFor('owner'),'codex')
 await f.finish(0);await until(()=>starts.length===2)
 assert.equal(starts[1].rpc.agentKind,'claude');assert.equal(starts[1].options.threadId,'claude-native');assert.ok(starts[1].options.input.some(i=>i.text?.includes('answer 0')))
 const oldRpc=starts[0].rpc;assert.equal(oldRpc.closed,true)
 await oldRpc.onEvent({method:'thread/status/changed',params:{threadId:'codex-native',status:{type:'active'}}})
 await f.finish(1);await until(()=>jobs.get(second).state==='done')
 const third=intake.submit('owner',{text:'换回继续',agentKind:'codex'},'back');await until(()=>starts.length===3)
 assert.equal(starts[2].options.threadId,'codex-native');await f.finish(2);await until(()=>jobs.get(third).state==='done')
 const saved=JSON.parse(await readFile(join(f.dir,'assistant-sessions.json'),'utf8')).users.owner
 assert.equal(saved.nativeSessions.claude.threadId,'claude-native');assert.equal(saved.nativeSessions.codex.threadId,'codex-native')
 const view=await macCompanion({owner:'owner',access:{read:()=>({writer:'wechat'})},conversations:{ensure:()=>({active:'1',entries:[{id:'1',key:'owner'}]})},manager:{state:{users:{owner:saved}},sessions:new Map()},jobs,stateDir:f.dir})({action:'view'})
 assert.deepEqual(view.messages.filter(m=>m.role==='助手').map(m=>m.text),['answer 0','answer 1','answer 2'])
 assert.equal(view.messages.filter(m=>m.role==='你').length,2)
})
test('unknown source or failed persistence never starts target',async t=>{
 const {manager,starts}=await fixture(t);manager.state.users.owner={activeAgent:'codex',threadId:'old',recovery:{execution:'unknown'}}
 await assert.rejects(manager.selectAgent('owner','claude'),/BLOCKED/);assert.equal(starts.length,0)
 manager.state.users.owner.recovery.execution='completed';manager.save=async()=>{throw Error('disk unavailable')}
 await assert.rejects(manager.selectAgent('owner','claude'),/disk unavailable/);assert.equal(manager.state.users.owner.threadId,'old');assert.equal(manager.agentFor('owner'),'codex')
})
test('management request is owned, idempotent and queues after the current durable source',async t=>{
 const f=await fixture(t),{manager,intake,starts,jobs}=f,operations=[],context={manager,operations,inflight:new Map(),now:Date.now,ready:()=>true,target:(owner,id)=>{if(owner!=='owner'||id!=='1')throw Error('MANAGEMENT_TARGET_NOT_FOUND');return {key:'owner',id:'1'}},enqueueTask:(...args)=>intake.submit(...args),result:op=>({status:op.status,data:op.data})}
 const source=intake.submit('owner',{text:'switch please'},'source');await until(()=>starts.length===1)
 const args={projectId:'1',agentKind:'claude',text:'请重新核实',handoff:{goal:'核实之前的修复'},requestId:'once'}
 const {handoff,...withoutNote}=args
 const missing=await requestAgentSwitch(context,'owner','owner',{...withoutNote,requestId:'missing-note'})
 assert.equal(missing.status,'rejected')
 jobs.add('other',{text:'private'},'foreign')
 const foreign=jobs.pending().find(job=>job.owner==='other')
 const invalid=await requestAgentSwitch(context,'owner','owner',{...args,handoff:{...handoff,evidenceTaskIds:[foreign.id]},requestId:'foreign-note'})
 assert.equal(invalid.status,'rejected')
 const a=await requestAgentSwitch(context,'owner','owner',args),b=await requestAgentSwitch(context,'owner','owner',args)
 assert.equal(a.status,'queued');assert.equal(a.data.taskId,b.data.taskId);assert.deepEqual(jobs.get(a.data.taskId).input.dependencies,[source]);assert.equal(starts.length,1)
 assert.equal((await requestAgentSwitch(context,'other','owner',{...args,requestId:'other'})).status,'rejected')
 await f.finish(0);await until(()=>starts.length===2);await f.finish(1);await until(()=>jobs.get(a.data.taskId).state==='done')
})
test('registering Claude preserves Codex default and survives default reselection',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'agent-register-'));t.after(()=>rm(dir,{recursive:true,force:true}));const options={account:{stateDir:dir,socket:join(dir,'socket')},inspect:async()=>{},probe:async()=>{throw Object.assign(Error(),{code:'ENOENT'})}}
 await agentCommand(['configure','claude','--binary','/fake/claude'],options);assert.deepEqual(await readAgentSelection(dir),{version:1,kind:'codex',claudeBinary:'/fake/claude'})
 await agentCommand(['select','codex'],options);assert.equal((await readAgentSelection(dir)).claudeBinary,'/fake/claude')
})
test('reopening state resumes the selected binding and a cancelled source never launches its dependent',async t=>{
 const f=await fixture(t),{manager,intake,starts,jobs}=f
 const source=intake.submit('owner',{text:'original'},'cancel-source');await until(()=>starts.length===1)
 const next=intake.submit('owner',{text:'follow',agentKind:'claude',internalHandoff:true,dependencies:[source]},'must-not-run')
 const s=starts[0];await s.rpc.onEvent({method:'turn/completed',params:{threadId:s.options.threadId,turn:{id:s.turnId,status:'interrupted'}}})
 await until(()=>jobs.get(next).state==='cancelled');assert.equal(starts.length,1);assert.equal(manager.agentFor('owner'),'codex')
 await manager.selectAgent('owner','claude');await manager.save()
 const restarted=await new SessionManager({stateDir:f.dir,cwd:f.dir,owners:['owner'],sessionProtocol:f.mux}).init()
 t.after(async()=>{restarted.close();await restarted.saving})
 assert.equal(restarted.agentFor('owner'),'claude');const session=await restarted.connect('owner',async()=>{})
 assert.equal(session.threadId,'claude-native');await restarted.selectAgent('owner','codex');assert.equal(restarted.state.users.owner.threadId,'codex-native')
})
test('handoff receipts report queued follow-up rather than finished work',async()=>{
 const {handoffReply}=await import('../../src/application/conversations/handoff-reply.mjs')
 const op={name:'request_agent_switch',status:'queued',caller:'owner',sourceTaskId:'source',data:{taskId:'follow',agentKind:'claude'}}
 const session={userId:'owner',taskId:'source'},state={managementOperations:[op]},job={id:'follow',owner:'owner',state:'pending',input:{internalHandoff:true,agentKind:'claude'}}
 assert.match(handoffReply(state,{get:()=>job},session),/排队后续任务/)
 job.state='uncertain';assert.match(handoffReply(state,{get:()=>job},session),/未确认完成/)
 job.owner='other';assert.match(handoffReply(state,{get:()=>job},session),/记录尚未确认/)
})
test('pending approvals and genuinely active native execution block switching; a stale active notification is rechecked',async t=>{
 const {manager}=await fixture(t)
 const session=await manager.connect('owner',async()=>{})
 manager.questions.set('q',{session})
 await assert.rejects(manager.selectAgent('owner','claude'),/BLOCKED/);manager.questions.clear()
 session.nativeStatus='active';const original=manager.protocol.read
 manager.protocol.read=async()=>({status:{type:'active'}})
 await assert.rejects(manager.selectAgent('owner','claude'),/BLOCKED/);assert.equal(manager.agentFor('owner'),'codex')
 manager.protocol.read=original
 await manager.selectAgent('owner','claude');assert.equal(manager.agentFor('owner'),'claude');assert.equal(session.rpc.closed,true)
})
test('messages arriving after an explicit handoff retain the queued target; another owner remains isolated',async t=>{
 const {manager,intake,jobs,starts}=await fixture(t)
 intake.users.set('owner',Promise.resolve());manager.owners.add('other');intake.users.set('other',Promise.resolve())
 const handoff=intake.submit('owner',{text:'handoff',agentKind:'claude',internalHandoff:true},'switch')
 const next=intake.submit('owner',{text:'再补充一点'},'supplement'),other=intake.submit('other',{text:'hi'},'other')
 assert.equal(jobs.get(next).input.agentKind,'claude');assert.equal(jobs.get(other).input.agentKind,null)
 jobs.bind(next,'claude-thread');jobs.bind(other,'other-thread');jobs.bind(handoff,'claude-thread')
 assert.deepEqual(jobs.companionMessages('owner',['codex-thread','claude-thread']).map(item=>item.id),[next]);assert.equal(starts.length,0)
})
test('Claude navigation and local title stay usable without sending its ID to the Codex catalog',async t=>{
 const f=await fixture(t),{manager}=f
 const {TextConversations}=await import('../../src/application/conversations/text-conversations.mjs'),{createCodexConversationBackend}=await import('../../src/infrastructure/agents/codex/conversation-backend.mjs')
 const conversations=new TextConversations(manager,['owner'],()=>({}),createCodexConversationBackend(manager))
 await manager.selectAgent('owner','claude')
 manager.createCatalogRpc=()=>assert.fail('must not send Claude ID to Codex')
 const replies=[]
 await conversations.selectConversation({_conversationOwner:'owner',userId:'owner',_conversationCommand:{action:'switch',id:'1'}},v=>replies.push(v))
 assert.match(replies[0],/已切换/);assert.equal(conversations.root.owner.active,'1')
 await conversations.rename(conversations.find('owner','1'),'同一条对话',()=>{})
 assert.equal(conversations.find('owner','1').name,'同一条对话')
})
test('replaying an existing pending submission never changes its frozen agent',async t=>{
 const {manager,intake,jobs}=await fixture(t);intake.users.set('owner',Promise.resolve())
 const id=intake.submit('owner',{text:'original',agentKind:'claude'},'same')
 manager.state.users.owner={activeAgent:'codex'}
 assert.equal(intake.submit('owner',{text:'different',agentKind:'codex'},'same'),id)
 assert.equal(jobs.get(id).input.agentKind,'claude');assert.equal(jobs.get(id).input.text,'original')
})

for(const kind of ['workbuddy','doubao','grok'])test(`${kind} switch verifies session without inference, restores Codex on auth failure and retains both native histories`,async t=>{
 const f=await fixture(t),{manager,intake,starts,jobs,mux}=f
 const first=intake.submit('owner',{text:'original'},'wb-source');await until(()=>starts.length===1);await f.finish(0);await until(()=>jobs.get(first).state==='done')
 const target=mux.forAgent(kind),open=target.open
 target.open=async()=>{throw Object.assign(Error(kind.toUpperCase()+'_LOGIN_REQUIRED'),{code:kind.toUpperCase()+'_LOGIN_REQUIRED'})}
 await assert.rejects(manager.selectAgent('owner',kind),/LOGIN_REQUIRED/)
 assert.equal(manager.agentFor('owner'),'codex');assert.equal(manager.state.users.owner.threadId,'codex-native');assert.equal(starts.length,1)
 assert.equal(JSON.parse(await readFile(join(f.dir,'assistant-sessions.json'),'utf8')).users.owner.activeAgent??'codex','codex')
 target.open=open;await manager.selectAgent('owner',kind);assert.equal(starts.length,1)
 assert.equal(manager.sessions.get('owner').threadId,kind+'-native')
 const second=intake.submit('owner',{text:'continue',agentKind:kind},'wb-target');await until(()=>starts.length===2)
 assert.equal(starts[1].rpc.agentKind,kind);assert.ok(starts[1].options.input.some(i=>i.text?.includes('answer 0')))
 await f.finish(1);await until(()=>jobs.get(second).state==='done');await manager.selectAgent('owner','codex')
 assert.equal(manager.state.users.owner.threadId,'codex-native');assert.equal(manager.state.users.owner.nativeSessions[kind].threadId,kind+'-native')
})
test('WorkBuddy title navigation stays local; its native ID never reaches Codex catalog',async t=>{
 const {manager}=await fixture(t)
 const {TextConversations}=await import('../../src/application/conversations/text-conversations.mjs'),{createCodexConversationBackend}=await import('../../src/infrastructure/agents/codex/conversation-backend.mjs')
 const conversations=new TextConversations(manager,['owner'],()=>({}),createCodexConversationBackend(manager))
 await manager.selectAgent('owner','workbuddy');manager.createCatalogRpc=()=>assert.fail('must not send WorkBuddy ID to Codex')
 await conversations.selectConversation({_conversationOwner:'owner',userId:'owner',_conversationCommand:{action:'switch',id:'1'}},()=>{})
 await conversations.rename(conversations.find('owner','1'),'WorkBuddy 任务',()=>{})
 assert.equal(conversations.find('owner','1').name,'WorkBuddy 任务')
})

for(const target of ['workbuddy','doubao','grok'])test(`real MCP switch to ${target} flows through scoped controller and durable queue, then resumes after restart`,async t=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js')
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js')
 const {fileURLToPath}=await import('node:url')
 const {RuntimeControl}=await import('../../src/infrastructure/runtime/runtime-control.mjs')
 const {controlEndpoint}=await import('../../src/infrastructure/runtime/control-endpoint.mjs')
 const {ManagementService}=await import('../../src/application/management/management-service.mjs')
 const {createManagementMcpController}=await import('../../src/interfaces/controllers/management-mcp-controller.mjs')
 const {TextConversations}=await import('../../src/application/conversations/text-conversations.mjs')
 const f=await fixture(t),{manager,intake,jobs,starts}=f
 const conversations=new TextConversations(manager,['owner'],()=>({}),{capabilities:{catalog:false},confirmSession:async()=>assert.fail('unexpected catalog access')})
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>intake.submit(...args)})
 const controller=createManagementMcpController({manager,service,configuration:capability=>({capability})})
 let client
 const socket=controlEndpoint(f.dir),runtime=new RuntimeControl({controlTokenFile:join(f.dir,'control-token'),onManagement:request=>controller.onRequest(request)})
 await runtime.listen(socket)
 t.after(async()=>{await client?.close();controller.close();await runtime.close()})
 const delivered=[]
 intake.reply=async(owner,value)=>{delivered.push({owner,value});return {status:'accepted'}}
 const source=intake.submit('owner',{text:`Switch to ${target} and verify the previous result.`},'mcp-switch-source')
 await until(()=>starts.length===1)
 const session=manager.sessions.get('owner'),binding=controller.bind(session,session.rpcAttempt)
 client=new Client({name:'switch-integration',version:'1'},{capabilities:{}})
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../src/interfaces/cli/management-mcp.mjs',import.meta.url))],env:{ZEROLINK_MANAGEMENT_SOCKET:socket,ZEROLINK_MANAGEMENT_CAPABILITY:binding.capability,...runtime.token?{ZEROLINK_MANAGEMENT_PIPE_TOKEN:runtime.token}:{}},stderr:'pipe'}))
 const before=(await client.callTool({name:'get_conversation_agents',arguments:{projectId:'1'}})).structuredContent
 assert.equal(before.activeAgent,'codex');assert.deepEqual(before.availableAgents,['codex','claude','workbuddy','doubao','grok'])
 const args={agentKind:target,text:'Verify the previous result without changing files.',handoff:{goal:'Verify the original regression',constraints:['Only inspect the fixtures'],openQuestions:['Recheck the failing input']},requestId:'mcp-switch-once'}
 const queued=(await client.callTool({name:'request_agent_switch',arguments:args})).structuredContent
 assert.equal(queued.status,'queued');assert.equal(manager.agentFor('owner'),'codex')
 const repeated=(await client.callTool({name:'request_agent_switch',arguments:args})).structuredContent
 assert.equal(repeated.data.taskId,queued.data.taskId)
 assert.deepEqual(jobs.get(queued.data.taskId).input.dependencies,[source])
 assert.equal(starts.length,1)
 // The source emits only the terminal event, with no final answer.
 await starts[0].rpc.onEvent({method:'turn/completed',params:{threadId:session.threadId,turn:{id:starts[0].turnId,status:'completed'}}})
 await until(()=>starts.length===2)
 assert.equal(manager.state.users.owner.resultIdentity.delivery,'not_required')
 assert.equal(starts[1].rpc.agentKind,target)
 assert.ok(starts[1].options.input.some(item=>item.text?.includes('Only inspect the fixtures')))
 assert.ok(starts[1].options.input.some(item=>item.text?.includes(`Switch to ${target} and verify the previous result.`)))
 assert.ok(starts[1].options.input.some(item=>item.text?.includes('排队后续任务')))
 const stale=await client.callTool({name:'get_conversation_agents',arguments:{projectId:'1'}})
 assert.equal(stale.isError,true);assert.match(stale.content[0].text,/MANAGEMENT_FORBIDDEN/)
 await f.finish(1);await until(()=>jobs.get(queued.data.taskId).state==='done')
 assert.ok(delivered.some(row=>row.owner==='owner'&&JSON.stringify(row.value).includes('answer 1')))
 assert.ok(!delivered.some(row=>JSON.stringify(row.value).includes('排队后续任务')))
 assert.equal(manager.state.users.owner.agentHandoff,undefined)
 assert.equal(manager.state.managementOperations.filter(op=>op.requestId===args.requestId).length,1)
 await client.close();controller.close();await runtime.close()
 intake.close();manager.close();await manager.saving
 const restarted=await new SessionManager({stateDir:f.dir,cwd:f.dir,owners:['owner'],sessionProtocol:f.mux}).init()
 t.after(async()=>{restarted.close();await restarted.saving})
 assert.equal(restarted.agentFor('owner'),target)
 const resumed=await restarted.connect('owner',async()=>({status:'accepted'}))
 assert.equal(resumed.threadId,target+'-native');assert.equal(starts.length,2)
 assert.equal(restarted.state.users.owner.nativeSessions.codex.threadId,'codex-native')
 await restarted.selectAgent('owner','codex')
 assert.equal(restarted.state.users.owner.threadId,'codex-native');assert.equal(starts.length,2)
})

test('unbound intake retains the original until a local choice, ignores a guessed executor and deduplicates replies',async t=>{
 const f=await fixture(t,false),replies=[]
 f.intake.reply=async(owner,value)=>{replies.push(value)}
 f.intake.conversations={realOwners:new Set(['owner']),ensure:()=>({entries:[{key:'owner',id:'1'}]})}
 const id=f.intake.submit('owner','检查这个项目','original')
 await until(()=>f.jobs.get(id).state==='waiting_agent')
 assert.equal(f.starts.length,0);assert.equal(f.manager.agentFor('owner'),null)
 assert.match(replies[0],/codex、claude/)
 const selection=f.intake.submit('owner','Claude','choice')
 await until(()=>f.starts.length===1)
 assert.equal(f.jobs.get(id).input.agentKind,'claude')
 assert.equal(f.jobs.get(id).input.text,'检查这个项目')
 assert.equal(f.jobs.get(selection).state,'done')
 assert.equal(f.intake.submit('owner','Claude','choice'),selection)
 await f.finish(0);await until(()=>f.jobs.get(id).state==='done')
 const change=f.intake.submit('owner','换成 Codex','switch-only')
 await until(()=>f.starts.length===2)
 assert.equal(f.starts[1].rpc.agentKind,'claude');assert.equal(f.jobs.get(change).input.text,'换成 Codex')
 await f.finish(1);await until(()=>f.jobs.get(change).state==='done')
})

test('a cancelled waiting request stays cancelled after an MCP switch without a follow-up',async t=>{
 const f=await fixture(t,false),{manager,intake,jobs}=f
 const id=intake.submit('owner','检查项目','wait')
 await until(()=>jobs.get(id).state==='waiting_agent')
 intake.cancel('owner')
 const {TextConversations}=await import('../../src/application/conversations/text-conversations.mjs')
 const {ManagementService}=await import('../../src/application/management/management-service.mjs')
 const conversations=new TextConversations(manager,['owner'],()=>({}),{capabilities:{catalog:false},confirmSession:async()=>assert.fail('unexpected connection')})
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>intake.submit(...args)})
 const result=await service.call('owner','request_agent_switch',{agentKind:'claude',requestId:'select-only'})
 assert.equal(result.status,'queued')
 await until(()=>jobs.get(result.data.taskId).state==='done')
 assert.equal(jobs.get(id).state,'cancelled');assert.equal(f.starts.length,0)
 assert.equal(manager.agentFor('owner'),'claude')
})

test('handoff selects an older cited task independently of intervening history and excludes unrelated tasks',async()=>{
 const {buildAgentHandoff}=await import('../../src/application/conversations/agent-handoff.mjs')
 const rows=new Map(),archive=[]
 for(let n=0;n<=10;n++){
  const taskId='task-'+n,turnId='turn-'+n
  rows.set(taskId,{id:taskId,owner:'owner',thread_id:'thread',turn_id:turnId,state:'done',input:{text:'request '+n}})
  archive.push({identity:{threadId:'thread',taskId,turnId},lastReply:'reply '+n,lastOutput:{attachments:[{fileName:'file-'+n}]}})
 }
 rows.get('task-10').input.dependencies=['task-3','foreign']
 rows.set('foreign',{owner:'another',input:{text:'private'}})
 const last=archive.pop()
 const record={threadId:'thread',resultIdentity:last.identity,lastReply:last.lastReply,resultArchive:archive}
 const packet=buildAgentHandoff(record,{id:'packet',owner:'owner',from:'codex',to:'claude',sourceTaskId:'task-10',jobs:rows,note:{goal:'Recheck original output',evidenceTaskIds:['task-0']}})
 assert.deepEqual(packet.evidence.map(row=>row.taskId),['task-10','task-0','task-3'])
 assert.equal(packet.evidence[0].requestExcerpt,'request 10')
 assert.deepEqual(packet.evidence[1].outputFiles,['file-0'])
 assert.ok(!JSON.stringify(packet).includes('reply 9'))
})

test('switch-only packet survives restart and a second switch before consumption',async t=>{
 const f=await fixture(t),{manager,intake,starts,jobs}=f
 const source=intake.submit('owner','Check the original request','check')
 await until(()=>starts.length===1);await f.finish(0);await until(()=>jobs.get(source).state==='done')
 await manager.selectAgent('owner','claude',{sourceTaskId:source,note:{goal:'Keep the original constraints'}})
 const restarted=await new SessionManager({stateDir:f.dir,cwd:f.dir,owners:['owner'],sessionProtocol:f.mux}).init()
 t.after(async()=>{restarted.close();await restarted.saving})
 restarted.submissions=jobs
 await restarted.selectAgent('owner','workbuddy')
 assert.equal(restarted.state.users.owner.agentHandoff.agentNote.goal,'Keep the original constraints')
 assert.equal(restarted.state.users.owner.agentHandoff.to,'workbuddy')
 assert.equal(restarted.state.users.owner.agentHandoff.evidence[0].taskId,source)
})

test('a bound executor receives the complete natural-language switch request once',async t=>{
 const {intake,jobs,starts,finish}=await fixture(t)
 const text='换成 workbuddy，重新设计前端团队官网'
 const id=intake.submit('owner',text,'switch-with-work')
 await until(()=>starts.length===1)
 assert.equal(starts[0].rpc.agentKind,'codex')
 assert.equal(jobs.get(id).input.text,text)
 assert.equal(intake.submit('owner',text,'switch-with-work'),id)
 await finish(0);await until(()=>jobs.get(id).state==='done')
 assert.equal(starts.length,1)
})

test('rejected Codex resume before a turn records no submission and permits switching',async t=>{
 const {intake,jobs,starts,manager}=await fixture(t)
 manager.connect=async()=>{throw Object.assign(Error('rejected'),{method:'thread/resume',definitiveRpcError:true,rpcCode:-32600})}
 const id=intake.submit('owner','检查前端团队官网','resume-fails')
 await until(()=>jobs.get(id).state==='cancelled')
 assert.equal(jobs.get(id).outcome,'not_submitted')
 assert.equal(jobs.uncertainCount('owner'),0);assert.equal(starts.length,0)
})
