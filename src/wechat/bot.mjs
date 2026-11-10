import {voiceCommandInput} from './voice-command-input.mjs'
import {trackLoginValidity} from './login-validity.mjs'
import {LifecycleNotice,welcomeMessage} from './lifecycle-notice.mjs'
import {setupLanguage} from '../setup/setup-locale.mjs'
import {createMessageProcessor} from './message-processor.mjs'
import {createCommandClassifier} from './command-classifier.mjs'
import {conversationInput} from '../interfaces/wechat/conversation-command.mjs'
import {createWeChatController} from '../interfaces/controllers/wechat-controller.mjs'
import {createWeChatPresenter} from '../interfaces/views/wechat-presenter.mjs'
import {createScheduleController} from '../interfaces/controllers/schedule-controller.mjs'
import {createUpdateController} from '../interfaces/controllers/update-controller.mjs'
import {setupModelTest} from '../setup/setup-model-test.mjs'
import {SetupReceipts} from '../setup/setup-receipts.mjs'
import {USER_GUIDE} from '../setup/user-guide.mjs'
import {SetupController,setupCommand} from '../setup/setup-controller.mjs'
import {readTerminalSetupStatus,terminalSetupFingerprint} from '../setup/terminal-setup-status.mjs'
import {readProviderProfile} from '../setup/provider-profile.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {ServiceManager} from '../setup/platform-service.mjs'
import {createToolNotifier} from './tool-status.mjs'
import {createInfrastructurePorts} from './infrastructure-ports.mjs'
import {AgentSwitcher} from '../setup/agent-switch.mjs'
import {ChatUpgrader} from '../setup/chat-upgrade.mjs'
import {TextConversations} from '../application/conversations/text-conversations.mjs'
import {createCodexConversationBackend} from '../infrastructure/agents/codex-conversation-backend.mjs'
import {TypingStatus,typingOwners} from './typing-status.mjs'
import {traceIngress} from '../infrastructure/wechat/ingress-trace.mjs'
import {accountPaths,assertAccount,assertUniqueLogin,rememberIdentity} from '../infrastructure/accounts/account-store.mjs'
import {DurableIntake} from '../application/tasks/durable-intake.mjs'
import {RuntimeControl} from '../infrastructure/runtime/runtime-control.mjs'
import {nonBlockingHandler} from './message-handler.mjs'
import {MessageDispatch} from './message-dispatch.mjs'
import {createDiagnosticLog,errorFields,createSdkLogger} from '../infrastructure/diagnostics/diagnostic-log.mjs'
import {browserLoginUrl} from '../infrastructure/wechat/pairing-state.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionManager } from './session-manager.mjs'

// 每个进程只服务一个账号。先确定账号、授权用户和智能体，再装配运行组件。
const account=accountPaths();await assertAccount(account.id)
const stateDir = account.stateDir
const installation=installConfig()
const cwd = installation.workspace
const infrastructure=createInfrastructurePorts()
const agent=await infrastructure.agent.load(account,cwd,installation)
const backend=agent.backend
const runtimeStateDir=backend.stateDir
await mkdir(stateDir, { recursive: true, mode: 0o700 })
const testing = process.argv.includes('--test-codex')
const owners = testing ? ['integration'] : JSON.parse(await readFile(join(stateDir, 'codex-owners.json'), 'utf8'))
if (!Array.isArray(owners) || !owners.length || !owners.every(id => typeof id === 'string')) throw new Error('Configure authorized WeChat owners first')
const testName = process.env.CODEX_TEST_SESSION ?? `${Date.now()}-${process.pid}`
if (testing && !/^[a-zA-Z0-9_-]+$/.test(testName)) throw new Error('Invalid test session name')
const diagnostic=createDiagnosticLog({dir:join(stateDir,testing?'integration-logs':'logs')})
const log=(event,fields)=>{void diagnostic.log(event,fields)}
log('service.started',{status:testing?'test':'live'})
const systemTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone
const scheduleGuidance=`服务当前系统时区为 ${systemTimeZone}。用户未指定时区时，按此时区理解本地时间；单次计划的 at 须使用目标日期对应偏移的 ISO 8601 时间。以下 +08:00 仅用于说明格式。定时能力由接入层保存和触发。只有用户明确要求时，调用源码目录 ${JSON.stringify(join(import.meta.dirname, '../interfaces/cli/schedule-cli.mjs'))}；通过标准输入传 JSON。单次提醒：{"action":"create","kind":"reminder","at":"2027-01-01T09:00:00+08:00","text":"开会"}。定时提交任务：{"action":"create","kind":"task","at":"2027-01-01T09:00:00+08:00","text":"汇总今日新闻"}。每天重复可用 "repeat":{"frequency":"daily","time":"09:00","timeZone":${JSON.stringify(systemTimeZone)}} 代替 at；每周重复把 frequency 改为 weekly 并传 weekdays（周一=1 至周日=7）。查看 {"action":"list"}（可传 offset 和 limit，单页最多 10 条），取消 {"action":"cancel","id":"计划 ID"}。kind=task 在到期时向原会话的持久任务队列提交原样文字，由该会话对应的任务执行链路处理；不预先声称任务完成。命令从环境读取当前会话标识，不能自行指定收件人或会话。创建后以工具返回的 ID 和下次时间为准。`
// 会话编排由应用层负责；底座协议由所选 agent.sessionOptions 注入。
const manager = await new SessionManager({log, completionMarkers:true, scheduleGuidance, stateDir: testing ? join(runtimeStateDir, 'integration', testName) : runtimeStateDir, cwd:backend.cwd, owners, backend, ...agent.sessionOptions }).init()
const agentSwitcher=new AgentSwitcher({account})
const upgrader=new ChatUpgrader()

if (testing) {
  try {
    const result = await manager.ask('integration', process.env.CODEX_TEST_QUESTION ?? '现在北京时间几点？', async text => console.log('CODEX_MESSAGE', text))
    if (result.status !== 'completed') throw new Error(`Codex test failed: ${result.status}`)
    console.log('CODEX_TEST_OK', result.reply)
  } finally { manager.close(); await manager.saving;await diagnostic.flush() }
  process.exit(0)
}

const setupController=await new SetupController({stateDir,accountId:account.id,runModelTest:options=>setupModelTest(manager,options)}).init()
const classifyMessage=createCommandClassifier()
const conversationBackend=createCodexConversationBackend(manager)
const conversations=new TextConversations(manager,owners,conversationInput,conversationBackend)
await manager.save()
const bot = infrastructure.wechat.createClient({ storage: 'file', storageDir: stateDir, logger: createSdkLogger(log) })
const notifyStart=bot.api.notifyStart.bind(bot.api)
bot.api.notifyStart=async(...args)=>{try{const result=await notifyStart(...args);log('wechat.notify_start',{status:result?.ret===0?'accepted':'unknown'});return result}catch(error){log('wechat.notify_start_failed',errorFields(error));throw error}}
const loginValidity=trackLoginValidity(bot)
const typingStatus=new TypingStatus({start:userId=>bot.sendTyping(conversations.recipient(userId)),stop:userId=>bot.stopTyping(conversations.recipient(userId)),log})
const typingTimer=setInterval(()=>typingStatus.sync(new Set([...typingOwners(manager)].map(key=>conversations.recipient(key)))),1000);typingTimer.unref()
// Device-code polling may take longer than the SDK's default GET timeout.
const apiGet = bot.http.apiGet.bind(bot.http)
bot.http.apiGet = async (baseUrl, path, headers) => {
  if (!path.startsWith('/ilink/bot/get_qrcode_status?')) return apiGet(baseUrl, path, headers)
  const data=(await bot.http.request({ method: 'GET', url: new URL(path, baseUrl).toString(), headers, timeoutMs: 65_000 })).data
  if(typeof data?.status==='string'&&!['expired','confirmed'].includes(data.status)){loginPollReady=true;markAwaitingLogin()}
  return data
}

let stopping=false,loggedIn=false,startupPhase='initializing',loginQrReady=false,loginPollReady=false
const markAwaitingLogin=()=>{if(loginQrReady&&loginPollReady&&!loggedIn)startupPhase='awaiting_login'}
const pending = new MessageDispatch()
const maintenancePending=new Map()
let intakeHandler,durable
const replayMaintenance=()=>{
 for(const [id,message] of maintenancePending){maintenancePending.delete(id);if(jobs.rawCurrent(id))intakeHandler(message)}
}
// 私有控制端点可在微信登录前启动，用于状态检查和维护控制。
const runtime=new RuntimeControl({
 backend:{id:backend.id,kind:backend.kind,agentKind:agent.kind,memoryMode:backend.memoryMode??'wechat'},
 features:{daily_assistant:true,setup_commands:true,native_memory:backend.memoryMode==='native',conversation_unread_delivery:true,same_turn_supplements:true,text_conversations:true,original_long_jpeg:true,original_long_png:true,merged_completion_footer:true,conversation_resume:true,wechat_plain_text:true,reviewed_notification_filter:true,native_typing_lifecycle:true,weixin_protocol_v2:true,lossless_message_ids:true,durable_cursor_checkpoint:true,quoted_messages:true,weixin_reliability_v2:true,voice_output:false,audio_file_output:true,native_voice_experimental:process.env.WECHAT_NATIVE_VOICE_EXPERIMENTAL==='1',native_tool_status:process.env.WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL==='1',native_tool_status_opt_in:true,weixin_quote_tool_audited:true,concise_notifications:true,material_prompt_compact:true,material_binding:true,intake_reliability:true,redundancy_cleanup:true,attachment_task_continuation:true,ingress_trace:true,independent_messages:true,explicit_collection:false,clear_recovery:true,semantic_turn_memory:false,compact_auto_memory:false,memory_v2:false,isolated_user_memory:false,woen_persona:true,concise_verify_workflow:true,account_fault_isolation:true,multi_account:true,task_labels:true,cancel_generation_guard:true,stage_progress:true,completion_markers:true,durable_inbox:true,delivery_failure_diagnostics:true,chunked_text:false,update_notice:true},
 onSchedule:request=>{if(!schedules)throw Error('SCHEDULE_STATE_UNAVAILABLE');return schedules.onRequest(request)},
 ready:()=>loggedIn&&loginValidity.valid&&bot.isRunning&&!stopping,
  startup:()=>startupPhase,
 snapshot:()=>({sessions:[...manager.sessions.values()].filter(s=>s.connecting||s.busy||s.finishing||s.queue.length).length,intake_queues:pending.users.size+(durable?.users.size??0),saves:manager.pendingSaves,outbound_queues:outgoing.queues.size,rpc:[...manager.sessions.values()].reduce((n,s)=>n+(s.rpc.pending?.size??0),0)}),
 onSeal:()=>bot.stop(),onResume:()=>{void (async()=>{if(bot.runPromise)await bot.runPromise.catch(()=>{});if(!stopping){await bot.start();replayMaintenance()}})().catch(e=>log('service.resume_failed',errorFields(e)))},
 onDrainRelease:replayMaintenance,
})
const mediaDependencies={
 log,
 prepare:async(message,token)=>{const start=Date.now(),messageId=message.raw?.message_id??message.raw?.client_id,trace_id=message._traceId;log('attachments.download_started',{trace_id,messageId});try{const r=await runtime.track('media',()=>infrastructure.media.prepare(message,stateDir,undefined,token?.signal));log('attachments.download_completed',{trace_id,messageId,duration_ms:Date.now()-start,count:r.attachments.length,bytes:r.attachments.reduce((n,a)=>n+(a.bytes??0),0),status:r.errors.length?'partial':'ok'});return r}catch(e){log('attachments.download_failed',{trace_id,messageId,duration_ms:Date.now()-start,...errorFields(e)});throw e}},
 compose:input=>runtime.track('media',()=>infrastructure.media.compose(input)),
 submit:(owner,input,token,ingressId)=>{if(token.current())durable.submit(owner,input,ingressId,[ingressId].filter(Boolean))},
}
const outgoing=infrastructure.wechat.createOutbound({bot,conversations,runtime,store:manager.outputStore,log})
const view=createWeChatPresenter({bot,conversations,outgoing,runtime})
const updates=createUpdateController({stateDir,sourceDir:join(import.meta.dirname,'../..'),owners,
 ready:()=>runtime.ready()&&runtime.status().idle&&!runtime.draining&&!runtime.sealed&&!stopping,view,log})
let schedules
try {schedules=await createScheduleController({stateDir,owners,ready:()=>runtime.ready()&&!runtime.sealed&&!runtime.draining,
 track:work=>runtime.track('schedule',work),manager,conversations,enqueueTask:(...args)=>durable.submit(...args),view,log})}
catch(error) {log('schedule.state_unavailable',{code:/^SCHEDULE_[A-Z_]+$/.test(error.message)?error.message:'SCHEDULE_STATE_UNAVAILABLE'})}
await runtime.listen(account.socket)
// 先打开持久收件库并接好入站处理链；登录成功后才恢复未完成工作。
const jobs=await infrastructure.storage.accountInbox(stateDir);manager.submissions=jobs
let welcomePending=false;try{welcomePending=JSON.parse(await readFile(join(stateDir,'welcome-pending.json'),'utf8')).pending===true}catch{}
let savedSetupLanguage;try{savedSetupLanguage=(await readTerminalSetupStatus(stateDir))?.language}catch{}
const noticeLanguage=savedSetupLanguage??setupLanguage()
const lifecycleNotice=new LifecycleNotice({stateDir,sourceDir:join(import.meta.dirname,'../..'),owners,welcomePending,language:noticeLanguage,
 welcomeText:async()=>{let result,profile;try{result=await readTerminalSetupStatus(stateDir);profile=await readProviderProfile(stateDir)}catch{}return result?.provider===agent.providerKind&&result.fingerprint===terminalSetupFingerprint(profile)?noticeLanguage==='en'?`Weixin Link is connected. ${result.model??'The subscription model'} passed a real inference test during setup. You can start chatting.`:'微信助手已连接，'+(result.model??'订阅模型')+' 已通过安装终端的真实推理测试。现在可以直接聊天。':welcomeMessage(noticeLanguage,account.id)},
 send:(owner,text)=>view.announcement(owner,text),log})
const setupReceipts=new SetupReceipts(stateDir)
let weixin,ingressTrace
const inbound=createWeChatController({bot,view,manager,jobs,conversations,runtime,setupController,setupReceipts,classifyMessage,
 normalizeVoice:voiceCommandInput,
 traceWire:wire=>ingressTrace.traceId(wire),traceMessage:message=>ingressTrace.callback(message),quote:message=>weixin.quote(message),dispatch:message=>intakeHandler(message),log})
weixin=infrastructure.wechat.installProtocol(bot,{db:jobs.db,log,prepareBatch:inbound.prepareBatch})
ingressTrace=traceIngress(bot,log)
manager.onToolStatus=process.env.WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL==='1'?createToolNotifier({send:(peer,event)=>bot.sendToolStatus(peer,event),serialize:(peer,fn)=>conversations.serialize(peer,fn),track:fn=>runtime.track('delivery',fn),recipient:key=>conversations.recipient(key),log}):undefined

durable=new DurableIntake({jobs,manager,log,reply:(userId,value,options)=>view.deliver(userId,value,options)})
manager.wakeRecovery=owner=>durable.wake(owner)
manager.lifecycle.onCancel(userId=>{pending.cancel(userId);durable.cancel(userId);typingStatus.sync(new Set([...typingOwners(manager)].map(key=>conversations.recipient(key))))})
bot.on('error', error => log('wechat.error',errorFields(error)))
const handleMessage=createMessageProcessor({view,manager,jobs,conversations,runtime,log,stateDir,accountId:account.id,lifecycleNotice,setupReceipts,setupController,agentSwitcher,upgrader,backend,owners,mediaDependencies,durable,classifyMessage,infrastructure,diagnosticServices:new ServiceManager(),diagnosticService:account.service,deferMaintenance:message=>maintenancePending.set(message._ingressId,message)})
intakeHandler=nonBlockingHandler(async message => {
  try {
    message=voiceCommandInput(message)
    const control=classifyMessage(message)
    if(control)await handleMessage(message)
    else await pending.enqueue(message.userId,()=>handleMessage(message),message._intakeToken)
  }
  catch (error) {
    log('message.handler_failed',{userId:message.userId,...errorFields(error)})
    if (manager.owners.has(message.userId)) {
      try { await view.directNotice(message,'消息接收或附件处理失败，请稍后重试。') }
      catch(error) { log('wechat.error_reply_failed',errorFields(error)) }
    }
  }
},error=>log('message.background_failed',errorFields(error)),{enter:()=>runtime.enter('ingress')})
bot.onMessage(inbound.onMessage)

// 退出时停止新工作，等待微信上下文与会话状态落盘，再关闭控制端点。
async function shutdown(signal){if(stopping)return;stopping=true;updates.close();schedules?.close();clearInterval(typingTimer);typingStatus.close();ingressTrace.close();durable.close();log('service.stopping',{signal,count:manager.sessions.size});bot.stop();await bot.contextStore.flush().catch(error=>log('wechat.context_save_failed',errorFields(error)));manager.lifecycle.listeners.clear();manager.close();await manager.saving.catch(error=>log('state.save_failed',errorFields(error)));log('service.stopped',{signal});await diagnostic.flush();await runtime.close();process.exit(0)}
process.once('SIGTERM',()=>{void shutdown('SIGTERM')});process.once('SIGINT',()=>{void shutdown('SIGINT')})

// 登录并核查账号身份后恢复积压消息，最后才启动微信轮询。
startupPhase='login_in_progress'
await bot.login({ callbacks: {
  onQrUrl: url => { startupPhase='login_in_progress';loginQrReady=!!browserLoginUrl(url);loginPollReady=false;markAwaitingLogin();log(loginQrReady?'wechat.login_url_ready':'wechat.login_url_invalid') },
  onScanned: () => log('wechat.qr_scanned'),
} })
const loginCheck=await assertUniqueLogin(account.id,bot.getCredentials());for(const issue of loginCheck.issues)log('account.other_profile_unreadable',{code:issue.code});await rememberIdentity(account,bot.getCredentials())
loggedIn=true;startupPhase='login_complete';schedules?.start();updates.start();for(const message of jobs.rawPending())intakeHandler(message);durable.resume();log('wechat.login_completed');console.log('LOGIN_OK CODEX_DEFAULT')
bot.on('poll:start',()=>{const timer=setTimeout(()=>{if(!stopping)void lifecycleNotice.start()},100);timer.unref()})
await bot.start()
