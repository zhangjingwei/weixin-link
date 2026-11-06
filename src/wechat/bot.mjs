import {createMessageProcessor} from './message-processor.mjs'
import {setupModelTest} from '../setup/setup-model-test.mjs'
import {SetupReceipts} from '../setup/setup-receipts.mjs'
import {USER_GUIDE} from './user-guide.mjs'
import {SetupController,setupCommand} from '../setup/setup-controller.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {createToolNotifier} from './tool-status.mjs'
import {installWeixinProtocol} from './weixin-protocol.mjs'
import {loadBackend} from '../base/codex/codex-backend.mjs'
import {TextConversations,conversationCommand} from '../core/text-conversations.mjs'
import {ScheduledDelivery} from '../integrations/news/scheduled-delivery.mjs'
import {TypingStatus,typingOwners} from './typing-status.mjs'
import {traceIngress} from '../core/ingress-trace.mjs'
import {accountPaths,assertAccount,assertUniqueLogin,rememberIdentity} from './accounts.mjs'
import {DurableJobs} from '../core/durable-jobs.mjs'
import {DurableIntake} from '../core/durable-intake.mjs'
import {OutputTransport,OutputStore} from '../media/outbound-media.mjs'
import {composeMediaInput} from '../media/media-preprocess.mjs'
import {RuntimeControl} from '../core/runtime-control.mjs'
import {nonBlockingHandler} from './message-handler.mjs'
import {MessageDispatch} from './message-dispatch.mjs'
import {createDiagnosticLog,errorFields,createSdkLogger} from '../core/diagnostic-log.mjs'
import { WeChatBot } from '@wechatbot/wechatbot'
import QRCode from 'qrcode'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionManager, controlCommand } from '../base/codex/codex-session.mjs'
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
const handleMessage=createMessageProcessor({bot,manager,jobs,conversations,runtime,log,stateDir,welcomePending,setupReceipts,setupController,backend,owners,backendStartupIssue,outgoing,mediaDependencies,durable})
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
