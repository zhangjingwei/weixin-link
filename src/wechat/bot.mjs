import {trackLoginValidity} from './login-validity.mjs'
import {systemNotice} from '../core/delivery/system-notice.mjs'
import {LifecycleNotice} from './lifecycle-notice.mjs'
import {diagnosticCommand} from '../core/diagnostics/diagnostic-commands.mjs'
import {createMessageProcessor} from './message-processor.mjs'
import {setupModelTest} from '../setup/setup-model-test.mjs'
import {codexAvailability} from '../setup/setup-core.mjs'
import {SetupReceipts} from '../setup/setup-receipts.mjs'
import {USER_GUIDE} from './user-guide.mjs'
import {SetupController,setupCommand} from '../setup/setup-controller.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {createToolNotifier} from './tool-status.mjs'
import {installWeixinProtocol} from './weixin-protocol.mjs'
import {loadAgentAdapter} from '../base/agent-adapter.mjs'
import {selectedAgentKind} from '../base/agent-selection.mjs'
import {AgentSwitcher,agentSwitchCommand} from '../setup/agent-switch.mjs'
import {ChatUpgrader,chatUpgradeCommand} from '../setup/chat-upgrade.mjs'
import {ClaudeConversations} from '../base/claude/claude-conversations.mjs'
import {ClaudeSetupController} from '../base/claude/claude-setup.mjs'
import {TextConversations,conversationCommand} from '../core/text-conversations.mjs'
import {TypingStatus,typingOwners} from './typing-status.mjs'
import {traceIngress} from '../core/intake/ingress-trace.mjs'
import {accountPaths,assertAccount,assertUniqueLogin,rememberIdentity} from './accounts.mjs'
import {DurableJobs} from '../core/intake/durable-jobs.mjs'
import {DurableIntake} from '../core/durable-intake.mjs'
import {OutputTransport} from '../media/outbound-media.mjs'
import {composeMediaInput} from '../media/media-preprocess.mjs'
import {RuntimeControl} from '../core/runtime/runtime-control.mjs'
import {ScheduleService} from '../core/schedules/schedule-service.mjs'
import {UpdateNotifier} from '../core/updates/update-notifier.mjs'
import {scheduleCommand} from '../core/schedules/schedule-commands.mjs'
import {nonBlockingHandler} from './message-handler.mjs'
import {MessageDispatch} from './message-dispatch.mjs'
import {createDiagnosticLog,errorFields,createSdkLogger} from '../core/diagnostics/diagnostic-log.mjs'
import { WeChatBot } from '@wechatbot/wechatbot'
import QRCode from 'qrcode'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionManager, controlCommand } from '../base/codex/codex-session.mjs'
import { hasMedia, prepareMedia } from '../media/media-input.mjs'

const account=accountPaths();await assertAccount(account.id)
const stateDir = account.stateDir
const installation=installConfig()
const cwd = installation.workspace
const agent=await loadAgentAdapter(account,cwd,{...installation,agentBackend:await selectedAgentKind(account,installation)})
const backend=agent.backend
const runtimeStateDir=backend.stateDir
await mkdir(stateDir, { recursive: true, mode: 0o700 })
const testing = process.argv.includes('--test-codex')
const owners = testing ? ['integration'] : JSON.parse(await readFile(join(stateDir, 'codex-owners.json'), 'utf8'))
if (!Array.isArray(owners) || !owners.length || !owners.every(id => typeof id === 'string')) throw new Error('Configure authorized WeChat owners first')
let backendStartupIssue=null;if(backend.kind==='podman')try{await backend.preflight(owners)}catch{backendStartupIssue='CONTAINER_NOT_READY'}
const testName = process.env.CODEX_TEST_SESSION ?? `${Date.now()}-${process.pid}`
if (testing && !/^[a-zA-Z0-9_-]+$/.test(testName)) throw new Error('Invalid test session name')
const diagnostic=createDiagnosticLog({dir:join(stateDir,testing?'integration-logs':'logs')})
const log=(event,fields)=>{void diagnostic.log(event,fields)}
log('service.started',{status:testing?'test':'live'})
const scheduleGuidance=`定时能力由接入层保存和触发。只有用户明确要求时，调用源码目录 ${JSON.stringify(join(import.meta.dirname, '../core/schedules/schedule-cli.mjs'))}；通过标准输入传 JSON。单次提醒：{"action":"create","kind":"reminder","at":"2026-11-07T09:00:00+08:00","text":"开会"}。定时运行 Codex：{"action":"create","kind":"task","at":"2026-11-07T09:00:00+08:00","text":"汇总今日新闻"}。每天重复可用 "repeat":{"frequency":"daily","time":"09:00","timeZone":"Asia/Shanghai"} 代替 at；每周重复把 frequency 改为 weekly 并传 weekdays（周一=1 至周日=7）。查看 {"action":"list"}（可传 offset 和 limit，单页最多 10 条），取消 {"action":"cancel","id":"计划 ID"}。kind=task 在到期时向本会话的 Codex 任务队列提交原样文字，不预先声称任务完成。必须使用本会话的 CODEX_THREAD_ID，不能自行指定收件人或会话。创建后以工具返回的 ID 和下次时间为准。`
const manager = await new SessionManager({log, completionMarkers:true, scheduleGuidance, stateDir: testing ? join(runtimeStateDir, 'integration', testName) : runtimeStateDir, cwd:backend.cwd, owners, backend, agentKind:agent.kind, ...agent.sessionOptions, ...(backend.kind==='podman'?{rpcFactory:backend.rpcFactory,remoteControl:backend.remoteControl,providerEnv:{}}:{}) }).init()
const agentSwitcher=new AgentSwitcher({account,installation,agentKind:agent.kind,backendReady:codexAvailability})
const upgrader=new ChatUpgrader()

if (testing) {
  try {
    const result = await manager.ask('integration', process.env.CODEX_TEST_QUESTION ?? '现在北京时间几点？', async text => console.log('CODEX_MESSAGE', text))
    if (result.status !== 'completed') throw new Error(`Codex test failed: ${result.status}`)
    console.log('CODEX_TEST_OK', result.reply)
  } finally { manager.close(); await manager.saving;await diagnostic.flush() }
  process.exit(0)
}

const setupController=await (agent.kind==='claude'?new ClaudeSetupController({binary:installation.claudeBinary}):new SetupController({stateDir,backend,accountId:account.id,runModelTest:options=>setupModelTest(manager,options)})).init()
const conversations=agent.catalog==='local'?new ClaudeConversations(manager,owners):new TextConversations(manager,owners)
await manager.save()
const bot = new WeChatBot({ storage: 'file', storageDir: stateDir, logger: createSdkLogger(log) })
const notifyStart=bot.api.notifyStart.bind(bot.api)
bot.api.notifyStart=async(...args)=>{try{const result=await notifyStart(...args);log('wechat.notify_start',{status:result?.ret===0?'accepted':'unknown'});return result}catch(error){log('wechat.notify_start_failed',errorFields(error));throw error}}
const loginValidity=trackLoginValidity(bot)
const typingStatus=new TypingStatus({start:userId=>bot.sendTyping(conversations.recipient(userId)),stop:userId=>bot.stopTyping(conversations.recipient(userId)),log})
const typingTimer=setInterval(()=>typingStatus.sync(new Set([...typingOwners(manager)].map(key=>conversations.recipient(key)))),1000);typingTimer.unref()
// Device-code polling may take longer than the SDK's default GET timeout.
const apiGet = bot.http.apiGet.bind(bot.http)
bot.http.apiGet = async (baseUrl, path, headers) => {
  if (!path.startsWith('/ilink/bot/get_qrcode_status?')) return apiGet(baseUrl, path, headers)
  return (await bot.http.request({ method: 'GET', url: new URL(path, baseUrl).toString(), headers, timeoutMs: 65_000 })).data
}

const remoteSequences=new Map()
let stopping=false,loggedIn=false
const pending = new MessageDispatch()
const runtime=new RuntimeControl({
 backend:{id:backend.id,kind:backend.kind,agentKind:agent.kind,container:backend.container??null,memoryMode:backend.memoryMode??'wechat'},
 features:{daily_assistant:true,numeric_setup_wizard:true,setup_commands:true,codex_backend_binding:true,container_backend:backend.kind==='podman',native_memory:backend.memoryMode==='native',conversation_unread_delivery:true,same_turn_supplements:true,text_conversations:true,original_long_jpeg:true,original_long_png:true,merged_completion_footer:true,conversation_resume:true,wechat_plain_text:true,reviewed_notification_filter:true,native_typing_lifecycle:true,weixin_protocol_v2:true,lossless_message_ids:true,durable_cursor_checkpoint:true,quoted_messages:true,weixin_reliability_v2:true,voice_output:false,audio_file_output:true,native_voice_experimental:process.env.WECHAT_NATIVE_VOICE_EXPERIMENTAL==='1',native_tool_status:process.env.WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL==='1',native_tool_status_opt_in:true,weixin_quote_tool_audited:true,concise_notifications:true,material_prompt_compact:true,material_binding:true,intake_reliability:true,redundancy_cleanup:true,attachment_task_continuation:true,ingress_trace:true,independent_messages:true,explicit_collection:false,clear_recovery:true,semantic_turn_memory:false,compact_auto_memory:false,memory_v2:false,isolated_user_memory:false,woen_persona:true,concise_verify_workflow:true,account_fault_isolation:true,multi_account:true,task_labels:true,cancel_generation_guard:true,stage_progress:true,completion_markers:true,durable_inbox:true,delivery_failure_diagnostics:true,chunked_text:false,remote_stream:true,update_notice:true},
 onRemoteText:async({scope,task,seq,chunkId,text})=>{
  if(typeof scope!=='string'||typeof task!=='string'||!Number.isSafeInteger(seq)||seq<1||typeof text!=='string'||text.length>6000)throw Error('Invalid progress')
  const session=[...manager.sessions.values()].find(s=>s.threadId===scope)
  if(!session?.busy||session.exited||!(session.workToken?.current()??false))throw Error('Inactive scope')
  const {RemoteController}=await import('../core/remote-tasks/remote-controller.mjs'),controller=new RemoteController({root:cwd,scope}),record=await controller.task(task)
  if(record.stop_confirmed||(await controller.store.read())._cancelled?.[controller.scope])throw Error('Cancelled task')
  if(typeof chunkId!=='string'||!/^[a-f0-9]{64}$/.test(chunkId))throw Error('Invalid chunk')
  const key=task+':'+chunkId;if(remoteSequences.has(key))return {accepted:true,duplicate:true}
  if(remoteSequences.size>1000)remoteSequences.delete(remoteSequences.keys().next().value)
  remoteSequences.set(key,seq)
  const sent=await manager.emit(session,text,()=>session.busy&&(session.workToken?.current()??false));if(!sent)throw Error('Delivery not confirmed')
  return {accepted:true}
 },
 onSchedule:request=>scheduleCommand(request,{manager,conversations,service:schedules}),
 ready:()=>loggedIn&&loginValidity.valid&&bot.isRunning&&!stopping,
 snapshot:()=>({sessions:[...manager.sessions.values()].filter(s=>s.connecting||s.busy||s.finishing||s.queue.length).length,intake_queues:pending.users.size+durable.users.size,saves:manager.pendingSaves,outbound_queues:outgoing.queues.size,rpc:[...manager.sessions.values()].reduce((n,s)=>n+(s.rpc.pending?.size??0),0)}),
 onSeal:()=>bot.stop(),onResume:()=>{void (async()=>{if(bot.runPromise)await bot.runPromise.catch(()=>{});if(!stopping)await bot.start()})().catch(e=>log('service.resume_failed',errorFields(e)))}
})
const mediaDependencies={
 log,
 prepare:async(message,token)=>{const start=Date.now(),messageId=message.raw?.message_id??message.raw?.client_id,trace_id=message._traceId;log('attachments.download_started',{trace_id,messageId});try{const r=await runtime.track('media',()=>prepareMedia(message,stateDir,undefined,token?.signal));log('attachments.download_completed',{trace_id,messageId,duration_ms:Date.now()-start,count:r.attachments.length,bytes:r.attachments.reduce((n,a)=>n+(a.bytes??0),0),status:r.errors.length?'partial':'ok'});return r}catch(e){log('attachments.download_failed',{trace_id,messageId,duration_ms:Date.now()-start,...errorFields(e)});throw e}},
 compose:input=>runtime.track('media',()=>composeMediaInput(input)),
 submit:(owner,input,token,ingressId)=>{if(token.current())durable.submit(owner,input,ingressId,[ingressId].filter(Boolean))},
}
const outgoing=new OutputTransport({store:manager.outputStore,log,send:async(userId,content)=>runtime.track('delivery',()=>content?.voice?bot.sendVoice(conversations.recipient(userId),content.voice):bot.send(conversations.recipient(userId),content))})
const deliverOriginal=outgoing.deliver.bind(outgoing);conversations.sendOutput=deliverOriginal
outgoing.deliver=(key,value,options)=>conversations.deliver(key,options?.conversationControl?systemNotice(value):value,options,deliverOriginal)
const updates=new UpdateNotifier({stateDir,sourceDir:join(import.meta.dirname,'../..'),owners,
 ready:()=>runtime.ready()&&runtime.status().idle&&!runtime.draining&&!runtime.sealed&&!stopping,
 send:(owner,text)=>outgoing.deliver(owner,text,{conversationControl:true,current:()=>runtime.ready()&&!runtime.draining&&!runtime.sealed&&!stopping}),log})
let schedules
try {schedules=await new ScheduleService({stateDir,owners,ready:()=>runtime.ready()&&!runtime.sealed&&!runtime.draining,track:work=>runtime.track('schedule',work),send:(owner,text)=>outgoing.deliver(owner,text,{conversationControl:true}),submitTask:(owner,key,text,id,at)=>{
 const entry=conversations.entry(key)
 if(agent.kind!=='codex'||backend.kind!=='host'||!entry||entry.owner!==owner||entry.deleted||entry.archived)throw Object.assign(Error('SCHEDULE_TASK_UNAVAILABLE'),{deliveryState:'failed'})
 const submissionId=durable.submit(key,{text},'schedule:'+id+':'+at)
 return {status:'accepted',submissionId}
},log}).init()}
catch(error) {log('schedule.state_unavailable',{code:/^SCHEDULE_[A-Z_]+$/.test(error.message)?error.message:'SCHEDULE_STATE_UNAVAILABLE'})}
await runtime.listen(account.socket)
const jobs=new DurableJobs(join(runtimeStateDir,'inbox.sqlite'));manager.submissions=jobs
let welcomePending=false;try{welcomePending=JSON.parse(await readFile(join(stateDir,'welcome-pending.json'),'utf8')).pending===true}catch{}
const lifecycleNotice=new LifecycleNotice({stateDir,sourceDir:join(import.meta.dirname,'../..'),owners,welcomePending,
 send:(owner,text)=>conversations.serialize(owner,async()=>{await runtime.track('delivery',()=>bot.sendAnnouncement(owner,systemNotice(text)));return {status:'accepted'}}),log})
const setupReceipts=new SetupReceipts(stateDir)
const stagedWires=new WeakMap(),originalParse=bot.parser.parse.bind(bot.parser)
bot.parser.parse=wire=>stagedWires.get(wire)??originalParse(wire)
const weixin=installWeixinProtocol(bot,{db:jobs.db,log,prepareBatch:async wires=>{
 if(runtime.sealed)throw Error('INGRESS_SEALED')
 const received=[],setupReceived=[]
 for(const wire of wires){const parsed=originalParse(wire);if(!parsed||!conversations.realOwners.has(parsed.userId))continue
  const previous=jobs.findCaptured(parsed);const message=previous??conversations.bind(parsed);message._traceId??=ingressTrace.traceId(wire);const frozenSetup=setupReceipts.get(parsed);if(frozenSetup){message._setupAction=frozenSetup.action;message._setupReceiptId=frozenSetup.id}if(!Object.hasOwn(message,'_setupAction'))message._setupAction=previous?null:setupController.command(message.text,message._conversationOwner??message.userId,message.userId);message.references??=weixin.quote(message);stagedWires.set(wire,message)
  const control=!hasMedia(message)&&(diagnosticCommand(message.text)||message._setupAction||agentSwitchCommand(message.text?.trim()??'')||chatUpgradeCommand(message.text)||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
  if(message._setupAction)setupReceived.push(message)
  if(!control)received.push(message)
 }
 await manager.save()
 for(const message of received)jobs.capture(message)
 for(const message of setupReceived){message._ingressId=jobs.capture(message)??message._ingressId;const receipt=setupReceipts.capture(message);if(receipt){message._setupAction=receipt.action;message._setupReceiptId=receipt.id}}
}})
const ingressTrace=traceIngress(bot,log)
manager.onToolStatus=process.env.WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL==='1'?createToolNotifier({send:(peer,event)=>bot.sendToolStatus(peer,event),serialize:(peer,fn)=>conversations.serialize(peer,fn),track:fn=>runtime.track('delivery',fn),recipient:key=>conversations.recipient(key),log}):undefined

const durable=new DurableIntake({jobs,manager,log,reply:(userId,value,options)=>outgoing.deliver(userId,value,options)})
manager.wakeRecovery=owner=>durable.wake(owner)
manager.lifecycle.onCancel(userId=>{void setupController.cancelBinding(conversations.recipient(userId)).catch(()=>{});pending.cancel(userId);durable.cancel(userId);typingStatus.sync(new Set([...typingOwners(manager)].map(key=>conversations.recipient(key))))})
bot.on('error', error => log('wechat.error',errorFields(error)))
const handleMessage=createMessageProcessor({bot,manager,jobs,conversations,runtime,log,stateDir,lifecycleNotice,setupReceipts,setupController,agentSwitcher,upgrader,backend,owners,backendStartupIssue,outgoing,mediaDependencies,durable})
const intakeHandler=nonBlockingHandler(async message => {
  try {
    const control=!hasMedia(message)&&(diagnosticCommand(message.text)||message._setupAction||agentSwitchCommand(message.text?.trim()??'')||chatUpgradeCommand(message.text)||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
    if(control)await handleMessage(message)
    else await pending.enqueue(message.userId,()=>handleMessage(message),message._intakeToken)
  }
  catch (error) {
    log('message.handler_failed',{userId:message.userId,...errorFields(error)})
    if (manager.owners.has(message.userId)) {
      try { await bot.reply({...message,userId:conversations.recipient(message.userId)},systemNotice('消息接收或附件处理失败，请稍后重试。')) }
      catch(error) { log('wechat.error_reply_failed',errorFields(error)) }
    }
  }
},error=>log('message.background_failed',errorFields(error)),{enter:()=>runtime.enter('ingress')})
bot.onMessage(message=>{
 const inboundTrace=ingressTrace.callback(message);message._traceId??=inboundTrace
 if(!conversations.realOwners.has(message._conversationOwner??message.userId)||runtime.sealed)return
 if(!message._conversationOwner)message=conversations.bind(message)
 if(!Object.hasOwn(message,'_setupAction'))message._setupAction=message._recovered?null:setupController.command(message.text,message._conversationOwner??message.userId,message.userId)
 if(!hasMedia(message)&&(diagnosticCommand(message.text)||message._setupAction||agentSwitchCommand(message.text?.trim()??'')||chatUpgradeCommand(message.text)||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))){intakeHandler(message);return}
 const token=manager.lifecycle.capture(message.userId)
 void (async()=>{try{await manager.save();if(!token.current())return;const id=jobs.capture(message);if(id){log('ingress.persisted',{trace_id:message._traceId,messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text'});intakeHandler({...message,_ingressId:id,_intakeToken:token})}}catch(error){log('ingress.persist_failed',{trace_id:message._traceId,...errorFields(error)});void bot.reply({...message,userId:conversations.recipient(message.userId)},systemNotice('消息未能持久保存，请稍后重试。')).catch(()=>{})}})()
})

async function shutdown(signal){if(stopping)return;stopping=true;updates.close();schedules?.close();clearInterval(typingTimer);typingStatus.close();ingressTrace.close();durable.close();log('service.stopping',{signal,count:manager.sessions.size});bot.stop();manager.lifecycle.listeners.clear();manager.close();await manager.saving.catch(error=>log('state.save_failed',errorFields(error)));log('service.stopped',{signal});await diagnostic.flush();await runtime.close();process.exit(0)}
process.once('SIGTERM',()=>{void shutdown('SIGTERM')});process.once('SIGINT',()=>{void shutdown('SIGINT')})

await bot.login({ callbacks: {
  onQrUrl: url => { QRCode.toFile(join(stateDir, 'login.png'), url, { width: 480, margin: 2 }).then(() => log('wechat.qr_ready')).catch(error => log('wechat.qr_failed',errorFields(error))) },
  onScanned: () => log('wechat.qr_scanned'),
} })
const loginCheck=await assertUniqueLogin(account.id,bot.getCredentials());for(const issue of loginCheck.issues)log('account.other_profile_unreadable',{code:issue.code});await rememberIdentity(account,bot.getCredentials())
loggedIn=true;schedules?.start();updates.start();for(const message of jobs.rawPending())intakeHandler(message);durable.resume();log('wechat.login_completed');console.log('LOGIN_OK CODEX_DEFAULT')
bot.on('poll:start',()=>{const timer=setTimeout(()=>{if(!stopping)void lifecycleNotice.start()},100);timer.unref()})
await bot.start()
