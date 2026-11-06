import {setupModelTest} from '../setup/setup-model-test.mjs'
import {SetupReceipts} from '../setup/setup-receipts.mjs'
import {welcomeGuideOnce} from './welcome-guide.mjs'
import {USER_GUIDE} from './user-guide.mjs'
import {codexAvailability} from '../setup/setup-core.mjs'
import {SetupController,setupCommand} from '../setup/setup-controller.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {createToolNotifier} from './tool-status.mjs'
import {installWeixinProtocol,quoteInput} from './weixin-protocol.mjs'
import {loadBackend} from '../codex/codex-backend.mjs'
import {TextConversations,conversationCommand} from '../core/text-conversations.mjs'
import {ScheduledDelivery} from '../integrations/news/scheduled-delivery.mjs'
import {TypingStatus,typingOwners} from './typing-status.mjs'
import {receiptPolicy} from '../core/notification-policy.mjs'
import {traceIngress} from '../core/ingress-trace.mjs'
import {accountPaths,assertAccount,assertUniqueLogin,rememberIdentity} from './accounts.mjs'
import {DurableJobs} from '../core/durable-jobs.mjs'
import {DurableIntake} from '../core/durable-intake.mjs'
import {OutputTransport,OutputStore} from '../media/outbound-media.mjs'
import {composeMediaInput} from '../media/media-preprocess.mjs'
import {RuntimeControl} from '../core/runtime-control.mjs'
import {nonBlockingHandler} from './message-handler.mjs'
import {MessageDispatch} from './message-dispatch.mjs'
import {voiceTextMessage} from '../media/voice-text.mjs'
import {createDiagnosticLog,errorFields,createSdkLogger} from '../core/diagnostic-log.mjs'
import {randomUUID} from 'node:crypto'
import { WeChatBot } from '@wechatbot/wechatbot'
import QRCode from 'qrcode'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {singleMedia} from '../media/single-media.mjs'
import { SessionManager, controlCommand } from '../codex/codex-session.mjs'
import { hasMedia, prepareMedia } from '../media/media-input.mjs'

const account=accountPaths();await assertAccount(account.id)
const stateDir = account.stateDir
const cwd = installConfig().workspace
const backend=await loadBackend(account,cwd)
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
const manager = await new SessionManager({log, completionMarkers:true, stateDir: testing ? join(runtimeStateDir, 'integration', testName) : runtimeStateDir, cwd:backend.cwd, owners, backend, ...(backend.kind==='podman'?{rpcFactory:backend.rpcFactory,remoteControl:backend.remoteControl,providerEnv:{}}:{}) }).init()

if (testing) {
  try {
    const result = await manager.ask('integration', process.env.CODEX_TEST_QUESTION ?? '现在北京时间几点？', async text => console.log('CODEX_MESSAGE', text))
    if (result.status !== 'completed') throw new Error(`Codex test failed: ${result.status}`)
    console.log('CODEX_TEST_OK', result.reply)
  } finally { manager.close(); await manager.saving;await diagnostic.flush() }
  process.exit(0)
}

const setupController=await new SetupController({stateDir,backend,accountId:account.id,runModelTest:options=>setupModelTest(manager,options)}).init()
const conversations=new TextConversations(manager,owners)
await manager.save()
const bot = new WeChatBot({ storage: 'file', storageDir: stateDir, logger: createSdkLogger(log) })
const typingStatus=new TypingStatus({start:userId=>bot.sendTyping(conversations.recipient(userId)),stop:userId=>bot.stopTyping(conversations.recipient(userId)),log})
const typingTimer=setInterval(()=>typingStatus.sync(new Set([...typingOwners(manager)].map(key=>conversations.recipient(key)))),1000);typingTimer.unref()
// Device-code polling may take longer than the SDK's default GET timeout.
const apiGet = bot.http.apiGet.bind(bot.http)
bot.http.apiGet = async (baseUrl, path, headers) => {
  if (!path.startsWith('/ilink/bot/get_qrcode_status?')) return apiGet(baseUrl, path, headers)
  return (await bot.http.request({ method: 'GET', url: new URL(path, baseUrl).toString(), headers, timeoutMs: 65_000 })).data
}

const scheduledOutputStore=backend.kind==='podman'?new OutputStore({stateDir:manager.stateDir,cwd}):manager.outputStore
const scheduledDelivery=new ScheduledDelivery({dbPath:join(stateDir,'scheduled-delivery.sqlite'),configPath:join(stateDir,'notification-jobs.json'),owners,prepare:(user,text)=>scheduledOutputStore.package(user,text),send:(user,packet,options)=>deliverOriginal(user,packet,options)})
const remoteSequences=new Map()
let stopping=false,loggedIn=false
const pending = new MessageDispatch()
const runtime=new RuntimeControl({
 backend:{id:backend.id,kind:backend.kind,container:backend.container??null,memoryMode:backend.memoryMode??'wechat'},
 features:{numeric_setup_wizard:true,setup_commands:true,codex_backend_binding:true,container_backend:backend.kind==='podman',native_memory:backend.memoryMode==='native',conversation_unread_delivery:true,same_turn_supplements:true,text_conversations:true,original_long_jpeg:true,original_long_png:true,merged_completion_footer:true,scheduled_delivery_progress:true,news_compact_input:true,news_full_body_html:true,scheduled_text_receipt:true,scheduled_notifications:true,conversation_resume:true,wechat_plain_text:true,reviewed_notification_filter:true,native_typing_lifecycle:true,weixin_protocol_v2:true,lossless_message_ids:true,durable_cursor_checkpoint:true,quoted_messages:true,weixin_reliability_v2:true,voice_output:false,audio_file_output:true,native_voice_experimental:process.env.WECHAT_NATIVE_VOICE_EXPERIMENTAL==='1',native_tool_status:process.env.WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL==='1',native_tool_status_opt_in:true,weixin_quote_tool_audited:true,concise_notifications:true,material_prompt_compact:true,material_binding:true,intake_reliability:true,redundancy_cleanup:true,attachment_task_continuation:true,ingress_trace:true,independent_messages:true,explicit_collection:false,clear_recovery:true,semantic_turn_memory:false,compact_auto_memory:false,memory_v2:false,isolated_user_memory:false,woen_persona:true,concise_verify_workflow:true,account_fault_isolation:true,multi_account:true,task_labels:true,cancel_generation_guard:true,stage_progress:true,completion_markers:true,durable_inbox:true,delivery_failure_diagnostics:true,chunked_text:false,remote_stream:true,target_hints:true},
 onScheduledText:body=>scheduledDelivery.deliver(body),
 onScheduledStatus:()=>scheduledDelivery.status(),
 onRemoteText:async({scope,task,seq,chunkId,text})=>{
  if(typeof scope!=='string'||typeof task!=='string'||!Number.isSafeInteger(seq)||seq<1||typeof text!=='string'||text.length>6000)throw Error('Invalid progress')
  const session=[...manager.sessions.values()].find(s=>s.threadId===scope)
  if(!session?.busy||session.exited||!(session.workToken?.current()??false))throw Error('Inactive scope')
  const {RemoteController}=await import(join(cwd,'remote-controller.mjs')),controller=new RemoteController({root:cwd,scope}),record=await controller.task(task)
  if(record.stop_confirmed||(await controller.store.read())._cancelled?.[controller.scope])throw Error('Cancelled task')
  if(typeof chunkId!=='string'||!/^[a-f0-9]{64}$/.test(chunkId))throw Error('Invalid chunk')
  const key=task+':'+chunkId;if(remoteSequences.has(key))return {accepted:true,duplicate:true}
  if(remoteSequences.size>1000)remoteSequences.delete(remoteSequences.keys().next().value)
  remoteSequences.set(key,seq)
  const sent=await manager.emit(session,text,()=>session.busy&&(session.workToken?.current()??false));if(!sent)throw Error('Delivery not confirmed')
  return {accepted:true}
 },
 ready:()=>loggedIn&&bot.isRunning&&!stopping,
 snapshot:()=>({sessions:[...manager.sessions.values()].filter(s=>s.connecting||s.busy||s.finishing||s.queue.length).length,intake_queues:pending.users.size+durable.users.size,saves:manager.pendingSaves,outbound_queues:outgoing.queues.size,rpc:[...manager.sessions.values()].reduce((n,s)=>n+(s.rpc.pending?.size??0),0)}),
 onSeal:()=>bot.stop(),onResume:()=>{void (async()=>{if(bot.runPromise)await bot.runPromise.catch(()=>{});if(!stopping)await bot.start()})().catch(e=>log('service.resume_failed',errorFields(e)))}
})
const mediaDependencies={
 log,
 prepare:async(message,token)=>{const start=Date.now(),messageId=message.raw?.message_id??message.raw?.client_id;log('attachments.download_started',{messageId});try{const r=await runtime.track('media',()=>prepareMedia(message,stateDir,undefined,token?.signal));log('attachments.download_completed',{messageId,duration_ms:Date.now()-start,count:r.attachments.length,bytes:r.attachments.reduce((n,a)=>n+(a.bytes??0),0),status:r.errors.length?'partial':'ok'});return r}catch(e){log('attachments.download_failed',{messageId,duration_ms:Date.now()-start,...errorFields(e)});throw e}},
 compose:input=>runtime.track('media',()=>composeMediaInput(input)),
 submit:(owner,input,token,ingressId)=>{if(token.current())durable.submit(owner,input,ingressId,[ingressId].filter(Boolean))},
}
const outgoing=new OutputTransport({store:manager.outputStore,log,send:async(userId,content)=>runtime.track('delivery',()=>content?.voice?bot.sendVoice(conversations.recipient(userId),content.voice):bot.send(conversations.recipient(userId),content))})
const deliverOriginal=outgoing.deliver.bind(outgoing);conversations.sendOutput=deliverOriginal
outgoing.deliver=(key,value,options)=>conversations.deliver(key,value,options,deliverOriginal)
await runtime.listen(account.socket)
const jobs=new DurableJobs(join(runtimeStateDir,'inbox.sqlite'));manager.submissions=jobs
let welcomePending=false;try{welcomePending=JSON.parse(await readFile(join(stateDir,'welcome-pending.json'),'utf8')).pending===true}catch{}
const setupReceipts=new SetupReceipts(stateDir)
const stagedWires=new WeakMap(),originalParse=bot.parser.parse.bind(bot.parser)
bot.parser.parse=wire=>stagedWires.get(wire)??originalParse(wire)
const weixin=installWeixinProtocol(bot,{db:jobs.db,log,prepareBatch:async wires=>{
 if(runtime.sealed)throw Error('INGRESS_SEALED')
 const received=[],setupReceived=[]
 for(const wire of wires){const parsed=originalParse(wire);if(!parsed||!conversations.realOwners.has(parsed.userId))continue
  const previous=jobs.findCaptured(parsed);const message=previous??conversations.bind(parsed);const frozenSetup=setupReceipts.get(parsed);if(frozenSetup){message._setupAction=frozenSetup.action;message._setupReceiptId=frozenSetup.id}if(!Object.hasOwn(message,'_setupAction'))message._setupAction=previous?null:setupController.command(message.text,message._conversationOwner??message.userId,message.userId);message.references??=weixin.quote(message);stagedWires.set(wire,message)
  const control=!hasMedia(message)&&(message._setupAction||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
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
async function handleMessage(message) {
  if(message._ingressId&&!jobs.rawCurrent(message._ingressId))return
  if(message._intakeToken&&!message._intakeToken.current())return
  if(message._contextToken)bot.contextStore.set(conversations.recipient(message.userId),message._contextToken)
  const trace_id=randomUUID()
  log('message.received',{trace_id,userId:message.userId,messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text',chars:message.text?.length??0})
  if (!manager.owners.has(message.userId)) {log('message.rejected',{trace_id,reason:'unauthorized'});return}
  if(welcomePending)await welcomeGuideOnce(stateDir,conversations.recipient(message.userId),value=>outgoing.deliver(message.userId,value,{conversationControl:true}))
  const initialControl=!hasMedia(message)&&(message._setupAction||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
  if(runtime.sealed)return
  if(runtime.draining&&!(typeof initialControl==='string'&&/^wizardChoice:\d+:3$/.test(initialControl))&&!['stop','exit','status','result','help'].includes(initialControl?.action)){
    jobs.acknowledge([message._ingressId].filter(Boolean))
    await runtime.track('delivery',()=>bot.reply({...message,userId:conversations.recipient(message.userId)},'服务正在维护重启，请稍后重新发送。'));return
  }
  const setupAction=!hasMedia(message)&&message._setupAction;if(setupAction){const receipt=message._setupReceiptId?{id:message._setupReceiptId}:setupReceipts.capture(message);if(!receipt||!setupReceipts.claim(receipt.id)){if(message._recovered){await outgoing.deliver(message.userId,'上次安装操作的结果需要核对，未重复执行。发送“安装向导”重新检测并继续。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean))}return;}const setupToken=manager.lifecycle.capture(message.userId);const setupReply=(value,options={})=>{if(!setupToken.current())throw Error('SETUP_CANCELLED');return options.sensitive?runtime.track('delivery',()=>bot.sendSensitiveText(conversations.recipient(message.userId),value)):outgoing.deliver(message.userId,value,{current:()=>setupToken.current(),conversationControl:true})};await runtime.track('setup',()=>setupController.handle(setupAction,setupReply,{signal:setupToken.signal,scope:message._conversationOwner??message.userId,executionKey:message.userId}));setupReceipts.finish(receipt.id);jobs.acknowledge([message._ingressId].filter(Boolean));return}
  if(!initialControl&&backend.kind==='podman'&&!manager.sessions.has(message.userId)){try{await backend.preflight(owners);backendStartupIssue=null}catch{backendStartupIssue='CONTAINER_NOT_READY'}if(backendStartupIssue){await outgoing.deliver(message.userId,'微信已连通，但绑定的容器未就绪。本条没有提交给模型；可发送“安装状态”“启动容器”“登录Codex”进行恢复。');jobs.acknowledge([message._ingressId].filter(Boolean));return}}
  if(!initialControl&&backend.kind==='host'&&!manager.sessions.has(message.userId)){
   const ready=await codexAvailability();if(!ready.installed||!ready.loggedIn){await outgoing.deliver(message.userId,!ready.installed?'微信已连通，Codex 尚未安装。本条没有提交给模型；发送“安装Codex”继续设置。':'微信已连通，Codex 尚未登录。本条没有提交给模型；发送“登录Codex”完成授权。');jobs.acknowledge([message._ingressId].filter(Boolean));return}
  }
  const transcribed=voiceTextMessage(message)
  if(transcribed){log('voice.transcript_forwarded',{trace_id,userId:message.userId,status:'wechat_asr_text'});message=transcribed}
  const media = hasMedia(message)
  if (!media && !message.text?.trim()){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const reply = (value,options) => outgoing.deliver(message.userId,value,options)
  const text = message.text?.trim() ?? ''
  if (!media && text.toLowerCase() === 'ping') { await reply('pong');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  if (text.length > 12_000) { await reply('消息过长，请拆成几条发送。');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  const token=message._intakeToken??manager.lifecycle.capture(message.userId)
  const messageId = message.raw?.message_id ?? message.raw?.client_id
  if (!message._recovered&&(media||initialControl)&&initialControl?.action!=='steer'&&!await manager.acceptMessage(message.userId,messageId)) return
  if(!hasMedia(message)&&await conversations.control(message,reply)){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const control = !media && controlCommand(text)
  if(!control&&!token.current())return
  const notice=receiptPolicy({media,busy:manager.sessions.get(message.userId)?.busy,waiting:!!manager.state.users[message.userId]?.waitingAttachment})
  message._receiptDeferred=notice==='defer'
  if(!control&&notice!=='defer'&&jobs.claimReceipt(message._ingressId)&&notice==='send'){
    try{void Promise.resolve(reply(media?'已收到附件，正在接收。':manager.sessions.get(message.userId)?.busy?'已收到，已排队。':'已收到，正在处理。')).catch(error=>log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)}))}catch(error){log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)})}
  }
  if(!control&&media){await singleMedia(message,token,mediaDependencies);return}
  // Controls must not wait behind a slow turn/start or an earlier message send.
  if(control){await manager.handle(message.userId,text,reply,control.action==='steer'?messageId:undefined,token);return}
  try {
    const current=()=>token.current()
    if(!current()){log('message.cancelled',{trace_id,userId:message.userId,reason:'control_cancelled'});return}
    durable.submit(message.userId,quoteInput(text,message.references),message._ingressId??(messageId===undefined?undefined:String(messageId)),[message._ingressId].filter(Boolean))
  }
  catch(error){log('message.dispatch_failed',{trace_id,userId:message.userId,...errorFields(error)});await reply('消息处理失败，请稍后再试。')}

}
const intakeHandler=nonBlockingHandler(async message => {
  try {
    const control=!hasMedia(message)&&(message._setupAction||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
    if(control)await handleMessage(message)
    else await pending.enqueue(message.userId,()=>handleMessage(message),message._intakeToken)
  }
  catch (error) {
    log('message.handler_failed',{userId:message.userId,...errorFields(error)})
    if (manager.owners.has(message.userId)) {
      try { await bot.reply({...message,userId:conversations.recipient(message.userId)},'消息接收或附件处理失败，请稍后重试。') }
      catch(error) { log('wechat.error_reply_failed',errorFields(error)) }
    }
  }
},error=>log('message.background_failed',errorFields(error)),{enter:()=>runtime.enter('ingress')})
bot.onMessage(message=>{
 ingressTrace.callback(message)
 if(!conversations.realOwners.has(message._conversationOwner??message.userId)||runtime.sealed)return
 if(!message._conversationOwner)message=conversations.bind(message)
 if(!Object.hasOwn(message,'_setupAction'))message._setupAction=message._recovered?null:setupController.command(message.text,message._conversationOwner??message.userId,message.userId)
 if(!hasMedia(message)&&(message._setupAction||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))){intakeHandler(message);return}
 const token=manager.lifecycle.capture(message.userId)
 void (async()=>{try{await manager.save();if(!token.current())return;const id=jobs.capture(message);if(id){log('ingress.persisted',{messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text'});intakeHandler({...message,_ingressId:id,_intakeToken:token})}}catch(error){log('ingress.persist_failed',errorFields(error));void bot.reply({...message,userId:conversations.recipient(message.userId)},'消息未能持久保存，请稍后重试。').catch(()=>{})}})()
})

async function shutdown(signal){if(stopping)return;stopping=true;clearInterval(typingTimer);typingStatus.close();ingressTrace.close();durable.close();log('service.stopping',{signal,count:manager.sessions.size});bot.stop();manager.lifecycle.listeners.clear();manager.close();await manager.saving.catch(error=>log('state.save_failed',errorFields(error)));log('service.stopped',{signal});await diagnostic.flush();await runtime.close();process.exit(0)}
process.once('SIGTERM',()=>{void shutdown('SIGTERM')});process.once('SIGINT',()=>{void shutdown('SIGINT')})

await bot.login({ callbacks: {
  onQrUrl: url => { QRCode.toFile(join(stateDir, 'login.png'), url, { width: 480, margin: 2 }).then(() => log('wechat.qr_ready')).catch(error => log('wechat.qr_failed',errorFields(error))) },
  onScanned: () => log('wechat.qr_scanned'),
} })
const loginCheck=await assertUniqueLogin(account.id,bot.getCredentials());for(const issue of loginCheck.issues)log('account.other_profile_unreadable',{code:issue.code});await rememberIdentity(account,bot.getCredentials())
loggedIn=true;for(const message of jobs.rawPending())intakeHandler(message);durable.resume();log('wechat.login_completed');console.log('LOGIN_OK CODEX_DEFAULT')
await bot.start()
