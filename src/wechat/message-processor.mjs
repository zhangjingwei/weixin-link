import {OutputStore} from '../media/outbound-media.mjs'
import {diagnosticCommand,handleDiagnostic} from '../core/diagnostics/diagnostic-commands.mjs'
import {randomUUID} from 'node:crypto'
import {codexAvailability} from '../setup/setup-core.mjs'
import {conversationCommand} from '../core/text-conversations.mjs'
import {controlCommand} from '../base/codex/control-command.mjs'
import {agentSwitchCommand} from '../setup/agent-switch.mjs'
import {chatUpgradeCommand} from '../setup/chat-upgrade.mjs'
import {hasMedia} from '../media/media-input.mjs'
import {voiceTextMessage} from '../media/voice-text.mjs'
import {receiptPolicy} from '../core/delivery/notification-policy.mjs'
import {singleMedia} from '../media/single-media.mjs'
import {quoteInput} from './weixin-protocol.mjs'
import {errorFields} from '../core/diagnostics/diagnostic-log.mjs'
import {systemNotice} from '../core/delivery/system-notice.mjs'
import {recoverFailedFinal} from '../core/delivery/failed-final-recovery.mjs'

export function createMessageProcessor({bot,manager,jobs,conversations,runtime,log,stateDir,lifecycleNotice,setupReceipts,setupController,agentSwitcher,upgrader,backend,owners,backendStartupIssue,outgoing,mediaDependencies,durable}){
return async function handleMessage(message) {
  if(message._ingressId&&!jobs.rawCurrent(message._ingressId))return
  if(message._intakeToken&&!message._intakeToken.current())return
  if(message._contextToken)bot.contextStore.set(conversations.recipient(message.userId),message._contextToken)
  const trace_id=randomUUID()
  log('message.received',{trace_id,userId:message.userId,messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text',chars:message.text?.length??0})
  if (!manager.owners.has(message.userId)) {log('message.rejected',{trace_id,reason:'unauthorized'});return}
  let lifecycleDelivery
  try{lifecycleDelivery=await lifecycleNotice?.onInbound(conversations.recipient(message.userId))}catch(error){log('lifecycle_notice.failed',{trace_id,...errorFields(error)})}
  const diagnosticAction=!hasMedia(message)&&diagnosticCommand(message.text)
  const agentAction=!hasMedia(message)&&agentSwitchCommand(message.text?.trim()??'')
  const upgradeAction=!hasMedia(message)&&chatUpgradeCommand(message.text)
  const initialControl=!hasMedia(message)&&(diagnosticAction||message._setupAction||agentAction||upgradeAction||conversationCommand(message.text?.trim()??'')||controlCommand(message.text?.trim()??''))
  if(runtime.sealed)return
  if(runtime.draining&&!(typeof initialControl==='string'&&/^wizardChoice:\d+:3$/.test(initialControl))&&!['stop','exit','status','result','help'].includes(initialControl?.action)){
    jobs.acknowledge([message._ingressId].filter(Boolean))
    await runtime.track('delivery',()=>bot.reply({...message,userId:conversations.recipient(message.userId)},systemNotice('服务正在维护重启，请稍后重新发送。')));return
  }
  const setupAction=!hasMedia(message)&&message._setupAction;if(setupAction){const receipt=message._setupReceiptId?{id:message._setupReceiptId}:setupReceipts.capture(message);if(!receipt||!setupReceipts.claim(receipt.id)){if(message._recovered){await outgoing.deliver(message.userId,'上次安装操作的结果需要核对，未重复执行。发送“安装向导”重新检测并继续。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean))}return;}const setupToken=manager.lifecycle.capture(message.userId);const setupReply=(value,options={})=>{if(!setupToken.current())throw Error('SETUP_CANCELLED');return options.sensitive?runtime.track('delivery',()=>bot.sendSensitiveText(conversations.recipient(message.userId),value)):outgoing.deliver(message.userId,value,{current:()=>setupToken.current(),conversationControl:true})};await runtime.track('setup',()=>setupController.handle(setupAction,setupReply,{signal:setupToken.signal,scope:message._conversationOwner??message.userId,executionKey:message.userId}));setupReceipts.finish(receipt.id);jobs.acknowledge([message._ingressId].filter(Boolean));return}
  if(diagnosticAction){const token=manager.lifecycle.capture(message.userId);await runtime.track('delivery',()=>handleDiagnostic(diagnosticAction,async(value)=>outgoing.deliver(message.userId,diagnosticAction==='export'?await new OutputStore({stateDir,cwd:process.cwd()}).package(message.userId,value):value,{current:()=>token.current(),conversationControl:true}),{stateDir}));jobs.acknowledge([message._ingressId].filter(Boolean));return}
  if(!initialControl&&backend.kind==='podman'&&!manager.sessions.has(message.userId)){try{await backend.preflight(owners);backendStartupIssue=null}catch{backendStartupIssue='CONTAINER_NOT_READY'}if(backendStartupIssue){await outgoing.deliver(message.userId,'微信已连通，但绑定的容器未就绪。本条没有提交给模型；可发送“安装状态”“启动容器”“登录智能体”进行恢复。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean));return}}
  if(!initialControl&&backend.kind==='host'&&backend.agentKind!=='claude'&&!manager.sessions.has(message.userId)){
   const ready=await codexAvailability();if(!ready.installed||!ready.loggedIn){await outgoing.deliver(message.userId,!ready.installed?'微信已连通，Codex 尚未安装。本条没有提交给模型；发送“安装智能体”继续设置。':'微信已连通，Codex 尚未登录。本条没有提交给模型；发送“登录智能体”完成授权。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean));return}
  }
  if(!initialControl&&backend.agentKind==='claude'&&!manager.sessions.has(message.userId)&&!process.env.ANTHROPIC_API_KEY&&!process.env.CLAUDE_CODE_USE_BEDROCK&&!process.env.CLAUDE_CODE_USE_VERTEX&&!process.env.CLAUDE_CODE_USE_FOUNDRY){await outgoing.deliver(message.userId,'微信已连通，但 Claude API 凭据未提供。本条没有提交给模型；发送“安装状态”查看当前配置。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const transcribed=voiceTextMessage(message)
  if(transcribed){log('voice.transcript_forwarded',{trace_id,userId:message.userId,status:'wechat_asr_text'});message=transcribed}
  const media = hasMedia(message)
  if (!media && !message.text?.trim()){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const reply = (value,options) => outgoing.deliver(message.userId,options?.checkpoint?value:systemNotice(value),options)
  const text = message.text?.trim() ?? ''
  if (!media && text.toLowerCase() === 'ping') { await reply('pong');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  if (text.length > 12_000) { await reply('消息过长，请拆成几条发送。');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  const token=message._intakeToken??manager.lifecycle.capture(message.userId)
  const messageId = message.raw?.message_id ?? message.raw?.client_id
  if (!message._recovered&&(media||initialControl)&&initialControl?.action!=='steer'&&!await manager.acceptMessage(message.userId,messageId)) return
  if(message._recovered&&(agentAction?.action==='restart'||upgradeAction)){
   await runtime.track('delivery',()=>outgoing.deliver(message.userId,'上次维护指令的结果待核对，未重复执行。可发“服务状态”查看当前服务。',{conversationControl:true}))
   jobs.acknowledge([message._ingressId].filter(Boolean));return
  }
  let recoveryDelivery
  if(!initialControl&&!hasMedia(message)&&!message._recovered){
   try{recoveryDelivery=await recoverFailedFinal(manager,message.userId,(key,value)=>outgoing.deliver(key,value,{conversationControl:true}));if(recoveryDelivery)log('delivery.recovery_attempt',{trace_id,status:recoveryDelivery})}
   catch(error){log('delivery.recovery_failed',{trace_id,...errorFields(error)})}
  }
  if(agentAction){
   await runtime.track('setup',async()=>{
    try{await agentSwitcher.handle(agentAction,value=>runtime.track('delivery',()=>outgoing.deliver(message.userId,value,{conversationControl:true})))}
    catch(error){log('agent.switch_failed',{trace_id,...errorFields(error)});await outgoing.deliver(message.userId,'智能体切换未完成；当前底座未确认改变。错误代码：'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'AGENT_SWITCH_FAILED'),{conversationControl:true})}
    finally{jobs.acknowledge([message._ingressId].filter(Boolean))}
   });return
  }
  if(upgradeAction){
   await runtime.track('setup',async()=>{
    try{await upgrader.handle(value=>runtime.track('delivery',()=>outgoing.deliver(message.userId,value,{conversationControl:true})))}
    catch(error){log('upgrade.request_failed',{trace_id,...errorFields(error)});await outgoing.deliver(message.userId,'升级未安排。错误代码：'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'CHAT_UPGRADE_FAILED'),{conversationControl:true})}
    finally{jobs.acknowledge([message._ingressId].filter(Boolean))}
   });return
  }
  if(!hasMedia(message)&&await conversations.control(message,reply)){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const control = !media && controlCommand(text)
  if(!control&&!token.current())return
  const notice=receiptPolicy({media,busy:manager.sessions.get(message.userId)?.busy,waiting:!!manager.state.users[message.userId]?.waitingAttachment})
  message._receiptDeferred=notice==='defer'
  if(!control&&notice!=='defer'&&jobs.claimReceipt(message._ingressId)&&notice==='send'){
    if(lifecycleDelivery==='accepted'||recoveryDelivery==='accepted')log('receipt.suppressed',{trace_id,reason:'other_notice_sent'})
    else try{void Promise.resolve(reply(media?'已收到附件，正在接收。':manager.sessions.get(message.userId)?.busy?'已收到，已排队。':'已收到，正在处理。')).catch(error=>log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)}))}catch(error){log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)})}
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
}
