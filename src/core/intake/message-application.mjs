import {handleDiagnostic} from '../diagnostics/diagnostic-commands.mjs'
import {randomUUID} from 'node:crypto'
import {receiptPolicy} from '../delivery/notification-policy.mjs'
import {errorFields} from '../diagnostics/diagnostic-log.mjs'
import {systemNotice} from '../delivery/system-notice.mjs'
import {recoverFailedFinal} from '../delivery/failed-final-recovery.mjs'

const READINESS_NOTICE = {
  CONTAINER_NOT_READY: '微信已连通，但绑定的容器未就绪。本条没有提交给模型；可发送“安装状态”“启动容器”“登录智能体”进行恢复。',
  CODEX_NOT_INSTALLED: '微信已连通，Codex 尚未安装。本条没有提交给模型；发送“安装智能体”继续设置。',
  CODEX_NOT_LOGGED_IN: '微信已连通，Codex 尚未登录。本条没有提交给模型；发送“登录智能体”完成授权。',
  CLAUDE_CREDENTIALS_REQUIRED: '微信已连通，但 Claude API 凭据未提供。本条没有提交给模型；发送“安装状态”查看当前配置。',
}

export function createMessageApplication({view,manager,jobs,conversations,runtime,log,stateDir,lifecycleNotice,management,mediaDependencies,durable,classifyMessage,hasMedia,normalizeVoice,singleMedia,quoteInput,agentReadiness,diagnosticPackage,deferMaintenance}){
return async function handleMessage(message) {
  if(message._ingressId&&!jobs.rawCurrent(message._ingressId))return
  if(message._intakeToken&&!message._intakeToken.current())return
  view.context(message.userId,message._contextToken)
  const trace_id=message._traceId??randomUUID()
  const deliver=(value,options)=>view.deliver(message.userId,value,{...options,traceId:options?.traceId??trace_id})
  log('message.received',{trace_id,userId:message.userId,messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text',chars:message.text?.length??0})
  if (!manager.owners.has(message.userId)) {log('message.rejected',{trace_id,reason:'unauthorized'});return}
  message=normalizeVoice(message)
  if(message._voiceTranscribed)log('voice.transcript_forwarded',{trace_id,userId:message.userId,status:'wechat_asr_text'})
  let lifecycleDelivery
  try{lifecycleDelivery=await lifecycleNotice?.onInbound(conversations.recipient(message.userId))}catch(error){log('lifecycle_notice.failed',{trace_id,...errorFields(error)})}
  const intent=classifyMessage(message)
  const diagnosticAction=intent?.kind==='diagnostic'?intent.value:null
  const agentAction=intent?.kind==='agent'?intent.value:null
  const upgradeAction=intent?.kind==='upgrade'?intent.value:null
  const initialControl=intent?.value
  if(runtime.sealed)return
  if(runtime.draining&&!(typeof initialControl==='string'&&/^wizardChoice:\d+:3$/.test(initialControl))&&!['stop','exit','status','result','help'].includes(initialControl?.action)){
    if(message._ingressId){
      deferMaintenance?.(message)
      try{await view.directNotice(message,'服务正在维护，当前消息已保留，恢复后继续处理。')}
      catch(error){log('maintenance.notice_unconfirmed',{trace_id,...errorFields(error)})}
      return
    }
    await view.directNotice(message,'服务正在维护重启，请稍后重新发送。');return
  }
  const setupAction=intent?.kind==='setup'?intent.value:null
  if(setupAction){await management.setup(setupAction,message,deliver);return}
  if(diagnosticAction){const token=manager.lifecycle.capture(message.userId);await runtime.track('delivery',()=>handleDiagnostic(diagnosticAction,async(value)=>deliver(diagnosticAction==='export'?await diagnosticPackage(message.userId,value):value,{current:()=>token.current(),conversationControl:true}),{stateDir}));jobs.acknowledge([message._ingressId].filter(Boolean));return}
  if(!initialControl&&!manager.sessions.has(message.userId)){
   const issue=await agentReadiness()
   if(issue){await deliver(READINESS_NOTICE[issue]??'微信已连通，但当前智能体未就绪。本条没有提交给模型；可发送“安装状态”核对配置。',{conversationControl:true});jobs.acknowledge([message._ingressId].filter(Boolean));return}
  }
  const media = hasMedia(message)
  if (!media && !message.text?.trim()){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const reply = (value,options) => deliver(options?.checkpoint?value:systemNotice(value),options)
  const text = message.text?.trim() ?? ''
  if (!media && text.toLowerCase() === 'ping') { await reply('pong');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  if (text.length > 12_000) { await reply('消息过长，请拆成几条发送。');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  const token=message._intakeToken??manager.lifecycle.capture(message.userId)
  const messageId = message.raw?.message_id ?? message.raw?.client_id
  if (!message._recovered&&(media||initialControl)&&initialControl?.action!=='steer'&&!await manager.acceptMessage(message.userId,messageId)) return
  if(message._recovered&&(agentAction?.action==='restart'||upgradeAction)){
   await runtime.track('delivery',()=>deliver('上次维护指令的结果待核对，未重复执行。可发“服务状态”查看当前服务。',{conversationControl:true}))
   jobs.acknowledge([message._ingressId].filter(Boolean));return
  }
  let recoveryDelivery
  if(!initialControl&&!hasMedia(message)&&!message._recovered){
   try{recoveryDelivery=await recoverFailedFinal(manager,message.userId,(key,value)=>view.deliver(key,value,{conversationControl:true,traceId:trace_id}));if(recoveryDelivery)log('delivery.recovery_attempt',{trace_id,status:recoveryDelivery})}
   catch(error){log('delivery.recovery_failed',{trace_id,...errorFields(error)})}
  }
  if(agentAction){await management.agent(agentAction,message,deliver,trace_id);return}
  if(upgradeAction){await management.upgrade(message,deliver,trace_id);return}
  if(!hasMedia(message)&&await conversations.control(message,reply)){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const control = intent?.kind==='session'?intent.value:null
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
    const quoted=quoteInput(text,message.references)
    durable.submit(message.userId,{...(typeof quoted==='string'?{text:quoted}:quoted),traceId:trace_id},message._ingressId??(messageId===undefined?undefined:String(messageId)),[message._ingressId].filter(Boolean))
  }
  catch(error){log('message.dispatch_failed',{trace_id,userId:message.userId,...errorFields(error)});await reply('消息处理失败，请稍后再试。')}

}
}
