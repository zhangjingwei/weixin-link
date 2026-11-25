import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'
import {handleDiagnostic} from '../diagnostics/diagnostic-commands.mjs'
import {randomUUID} from 'node:crypto'
import {receiptPolicy} from '../../domain/delivery/receipt-policy.mjs'
import {errorFields} from '../../infrastructure/diagnostics/diagnostic-log.mjs'
import {recoverFailedFinal} from '../notifications/failed-final-recovery.mjs'
import {isResultLookup} from './catalog-question.mjs'
import {nativeCommandKind} from './native-command-kind.mjs'

export function createMessageApplication({entryRouting,view,manager,jobs,conversations,runtime,log,stateDir,lifecycleNotice,management,mediaDependencies,durable,classifyMessage,hasMedia,normalizeVoice,singleMedia,quoteInput,diagnosticPackage,confirmedRejection,deferMaintenance,systemNotice,diagnosticServices,diagnosticService}){
return async function handleMessage(message) {
  if(message._ingressId&&!jobs.rawCurrent(message._ingressId))return
  if(message._intakeToken&&!message._intakeToken.current())return
  view.context(message.userId,message._contextToken)
  const trace_id=message._traceId??randomUUID()
  const deliver=(value,options)=>view.deliver(message.userId,value,{...options,traceId:options?.traceId??trace_id})
  log('message.received',{trace_id,userId:message.userId,messageId:message.raw?.message_id??message.raw?.client_id,kind:hasMedia(message)?'media':'text',chars:message.text?.length??0})
  if (!manager.owners.has(message.userId)) {log('message.rejected',{trace_id,reason:'unauthorized'});return}
  if(!message._recovered)manager.recordUserInput?.(message.userId)
  message=normalizeVoice(message)
  if(message._voiceTranscribed)log('voice.transcript_forwarded',{trace_id,userId:message.userId,status:'wechat_asr_text'})
  let lifecycleDelivery
  try{lifecycleDelivery=await lifecycleNotice?.onInbound(conversations.recipient(message.userId))}catch(error){log('lifecycle_notice.failed',{trace_id,...errorFields(error)})}
  const intent=classifyMessage(message)
  const diagnosticAction=intent?.kind==='diagnostic'?intent.value:null
  const agentAction=intent?.kind==='agent'?intent.value:null
  const upgradeAction=intent?.kind==='upgrade'?intent.value:null
  const initialControl=intent?.value
  const nativeKind=nativeCommandKind(intent)
  if(runtime.sealed)return
  if(runtime.draining&&!['stop','exit','help'].includes(initialControl?.action)){
    if(message._ingressId){
      deferMaintenance?.(message)
      try{await view.directNotice(message,'服务正在维护，当前消息已保留，恢复后继续处理。')}
      catch(error){log('maintenance.notice_unconfirmed',{trace_id,...errorFields(error)})}
      return
    }
    await view.directNotice(message,'服务正在维护重启，请稍后重新发送。');return
  }
  if(message._desktopQuit){
   if(message._recovered){
    await deliver('上次退出桌面端的结果待核对。如仍需退出，请重新发送“关闭桌面端”。',{conversationControl:true})
   }else if(message._ingressId&&jobs.claimReceipt(message._ingressId)){
    await runtime.track('management',()=>durable.quitDesktop(message,value=>deliver(value,{conversationControl:true})))
   }
   jobs.acknowledge([message._ingressId].filter(Boolean))
   return
  }
  const desktopConfirmation=!hasMedia(message)&&!message.references?.length&&message.text?.trim().match(/^(继续|取消)(?:\s+([a-f0-9]{8}))?$/)
  const choices=message._desktopChoices??[]
  if(desktopConfirmation&&durable.confirmDesktop&&(desktopConfirmation[2]||choices.length)){
   if(!desktopConfirmation[2]&&choices.length>1){
    jobs.acknowledge([message._ingressId].filter(Boolean))
    const lines=choices.map(code=>{
     const job=jobs.desktopJob(message.userId,code)
     return job?taskDisplayTitle(job.input)+' — '+desktopConfirmation[1]+' '+code:null
    }).filter(Boolean)
    await deliver(lines.length?'有多条消息在等确认，请选择一条回复：\n'+lines.join('\n'):'这项确认已经失效。',{conversationControl:true})
    return
   }
   await runtime.track('management',()=>durable.confirmDesktop(message,desktopConfirmation[1],desktopConfirmation[2]??choices[0],value=>deliver(value,{conversationControl:true})))
   return
  }
  const setupAction=intent?.kind==='setup'?intent.value:null
  if(setupAction){await management.setup(setupAction,message,deliver);return}
  if(diagnosticAction){const token=manager.lifecycle.capture(message.userId);await runtime.track('delivery',()=>handleDiagnostic(diagnosticAction,async(value)=>deliver(diagnosticAction==='export'?await diagnosticPackage(message.userId,value):value,{current:()=>token.current(),conversationControl:true}),{stateDir,service:diagnosticService,services:diagnosticServices}));jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const media = hasMedia(message)
  const text = message.text?.trim() ?? ''
  const owner = message._conversationOwner ?? message.userId
  const conversation = manager.state.textConversations?.[owner]
  const greeting = !intent && !media && !message.references?.length && !message._promptReply &&
    !manager.state.users[message.userId]?.waitingAttachment && !conversation?.entryClarification &&
    !conversation?.entryRoutes?.[message._ingressId] && /^(?:你好|您好|嗨|哈喽|hi|hello)[！!。.]*$/iu.test(text)
  if (!media && !message.text?.trim()){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  const reply = (value,options) => deliver(options?.checkpoint?value:systemNotice(value),options)
  if (!media && text.toLowerCase() === 'ping') { await reply('pong');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  if (text.length > 12_000) { await reply('消息过长，请拆成几条发送。');jobs.acknowledge([message._ingressId].filter(Boolean)); return }
  const token=message._intakeToken??manager.lifecycle.capture(message.userId)
  const messageId = message.raw?.message_id ?? message.raw?.client_id
  const capturedStop = initialControl?.action==='stop' && message._ingressId && (message._recovered || Object.hasOwn(message,'_stopTrace'))
  if(capturedStop){
    const session=manager.sessions.get(message.userId)
    if(message._recovered || message._stopTrace !== (session?.traceId ?? null)){
      jobs.acknowledge([message._ingressId])
      await reply('已记录对原任务的停止请求，停止结果待核对。可发送“状态”查看。')
      return
    }
  }
  if (!message._recovered&&(media||initialControl)&&initialControl?.action!=='steer'&&!await manager.acceptMessage(message.userId,messageId)) return
  if(message._recovered&&nativeKind==='mutation'){
    await runtime.track('delivery',()=>deliver('上次原生命令的执行结果待核对，未重复执行。请查询对应状态后再决定是否重新发送。',{conversationControl:true}))
    jobs.acknowledge([message._ingressId].filter(Boolean));return
  }
  if(message._recovered&&(agentAction?.action==='restart'||upgradeAction)){
   await runtime.track('delivery',()=>deliver('上次维护操作是否完成还不确定，没有重复执行。你可以说“检查助手服务是否正常”。',{conversationControl:true}))
   jobs.acknowledge([message._ingressId].filter(Boolean));return
  }
  let recoveryDelivery
  if(!initialControl&&!hasMedia(message)&&!message._recovered&&!isResultLookup(text)){
   try{recoveryDelivery=await recoverFailedFinal(manager,message.userId,(key,value)=>view.deliver(key,value,{conversationControl:true,traceId:trace_id}),confirmedRejection);if(recoveryDelivery)log('delivery.recovery_attempt',{trace_id,status:recoveryDelivery})}
   catch(error){log('delivery.recovery_failed',{trace_id,...errorFields(error)})}
  }
  if(agentAction){await management.agent(agentAction,message,deliver,trace_id);return}
  if(upgradeAction){await management.upgrade(message,deliver,trace_id);return}
  if(!hasMedia(message)&&await conversations.control(message,reply)){jobs.acknowledge([message._ingressId].filter(Boolean));return}
  let control = intent?.kind==='session'?intent.value:null
  if(control?.action==='reviewCommit'){
    try{control=manager.resolveReviewCommit(message.userId,control.selection)}
    catch(error){await reply(error.message);jobs.acknowledge([message._ingressId].filter(Boolean));return}
  }
  if(!control&&!token.current())return
  // Standalone greetings are ordinary conversation, never an entry-routing action or canned notice.
  if(!control&&!greeting&&!media&&entryRouting&&await entryRouting.process(message,token))return
  const notice=receiptPolicy({media,busy:manager.sessions.get(message.userId)?.busy,waiting:!!manager.state.users[message.userId]?.waitingAttachment})
  message._receiptDeferred=notice==='defer'
  if(!control&&notice!=='defer'&&jobs.claimReceipt(message._ingressId)&&notice==='send'){
    if(lifecycleDelivery==='accepted'||recoveryDelivery==='accepted')log('receipt.suppressed',{trace_id,reason:'other_notice_sent'})
    else try{void Promise.resolve(reply(media?'已收到附件，正在接收。':manager.sessions.get(message.userId)?.busy?'已收到，已排队。':'已收到，正在处理。')).catch(error=>log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)}))}catch(error){log('receipt.delivery_unconfirmed',{trace_id,...errorFields(error)})}
  }
  if(!control&&media){await singleMedia(message,token,mediaDependencies);return}
  // Controls must not wait behind a slow turn/start or an earlier message send.
  if(control?.action==='review'){
    if(!manager.supportsNativeCommands){await reply(`当前 ${manager.agentName} 底座未接入这项原生命令；没有执行。`);jobs.acknowledge([message._ingressId].filter(Boolean));return}
    if(!token.current())return
    const input=control.target?.type==='commit'?'请审查选定的提交。':control.target?.type==='baseBranch'?'请审查与指定分支相比的改动。':'请审查当前工作区变更。'
    durable.submit(message.userId,{text:input,nativeCommand:control,traceId:trace_id},message._ingressId??(messageId===undefined?undefined:String(messageId)),[message._ingressId].filter(Boolean))
    return
  }
  if(control){
    const command=capturedStop?{...control,stopIngressId:message._ingressId,stopTrace:message._stopTrace}:control
    await manager.handle(message.userId,text,reply,control.action==='steer'?messageId:undefined,token,control.action==='steer'&&message._chatReceipt?{...command,chatReceipt:message._chatReceipt}:command)
    if(nativeKind==='mutation'||capturedStop)jobs.acknowledge([message._ingressId].filter(Boolean))
    return
  }
  try {
    const current=()=>token.current()
    if(!current()){log('message.cancelled',{trace_id,userId:message.userId,reason:'control_cancelled'});return}
    const quoted=quoteInput(text,message.references)
    durable.submit(message.userId,{...(typeof quoted==='string'?{text:quoted}:quoted),traceId:trace_id},message._ingressId??(messageId===undefined?undefined:String(messageId)),[message._ingressId].filter(Boolean))
  }
  catch(error){log('message.dispatch_failed',{trace_id,userId:message.userId,...errorFields(error)});await reply('消息处理失败，请稍后再试。')}

}
}
