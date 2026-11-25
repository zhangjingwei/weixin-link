import {errorFields} from '../../infrastructure/diagnostics/diagnostic-log.mjs'
import {nativeCommandKind} from './native-command-kind.mjs'

/** Own receipt and fast-control decisions after the transport parses a wire. */
export function createReceiveMessage({manager, jobs, view, dispatch, hasMedia, conversations, runtime, setupController, setupReceipts, normalizeVoice, classifyMessage, deferMaintenance, log = () => {}}) {
  const threadOf=message=>manager.state?.users?.[message.userId]?.threadId??''
  const chatThread=(message,intent)=>!message._setupAction&&!message._promptReply&&!message._conversationCommand&&(!intent||intent.kind==='session'&&intent.value.action==='steer')
    ?message._chatThread??threadOf(message):null
  return {
    prepare(parsed, {traceId, quote}) {
      const previous = jobs.findCaptured(parsed)
      const message = previous ?? conversations.bind(normalizeVoice(parsed))
      message._chatThread ??= threadOf(message)
      message._traceId ??= traceId
      const frozenSetup = setupReceipts.get(parsed)
      if (frozenSetup) {
        message._setupAction = frozenSetup.action
        message._setupReceiptId = frozenSetup.id
      }
      if (!Object.hasOwn(message, '_setupAction')) message._setupAction = previous||message._promptReply ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
      message.references ??= quote(message)
      if(!previous&&!message._promptReply&&!message._conversationCommand&&!message._sessionCommand&&!hasMedia(message)&&!message.references?.length&&/^(继续|取消)$/.test(message.text?.trim())){
       const threadId=manager.state?.users?.[message.userId]?.threadId
       if(threadId)message._desktopChoices=jobs.desktopChoices?.(message.userId,threadId)
      }
      if(!previous&&!message._promptReply&&!message._conversationCommand&&!message._sessionCommand&&!hasMedia(message)&&!message.references?.length&&/^(?:退出|关闭)桌面(?:端|版|应用)[。！!]?$/.test(message.text?.trim())){
        message._desktopQuit={threadId:manager.state.users[message.userId]?.threadId??null}
      }
      return message
    },
    async captureBatch(messages) {
      // beforeCheckpoint awaits this whole operation; failure blocks the cursor.
      await manager.save()
      for (const message of messages) {
        const intent = classifyMessage(message)
        const stop = intent?.kind === 'session' && intent.value.action === 'stop' && !manager.state?.desktopHandoff
        if (message._desktopQuit || !intent || nativeCommandKind(intent) || stop || message._setupAction) {
          if (!stop) message._ingressId = jobs.capture(message,chatThread(message,intent))
          if (stop) {
            const {id, fresh} = jobs.captureStop(message)
            message._ingressId = id
            const session = manager.sessions?.get(message.userId)
            message._stopTrace = session?.traceId ?? null
            if (fresh) manager.lifecycle.cancel(message.userId, {preserveActive: !!(session?.busy || session?.finishing), queueAlreadyCancelled: true})
            else message._recovered = true
          }
        }
        if(intent?.kind==='session'&&intent.value.action==='steer'&&!message._captureState)message._chatReceipt=jobs.observeSupplement(message,chatThread(message,intent))
        if (!message._setupAction) continue
        const receipt = setupReceipts.capture(message)
        if (receipt) {
          message._setupAction = receipt.action
          message._setupReceiptId = receipt.id
        }
      }
    },
    onMessage(message) {
      if (!conversations.realOwners.has(message._conversationOwner ?? message.userId)) return
      message = normalizeVoice(message)
      if (!message._conversationOwner) message = conversations.bind(message)
      if (!Object.hasOwn(message, '_setupAction')) message._setupAction = message._recovered||message._promptReply ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
      if (Object.hasOwn(message, '_ingressId')) {
        if (!message._ingressId) return
        const captured = {...message, _intakeToken: manager.lifecycle.capture(message.userId)}
        log('ingress.persisted', {trace_id: message._traceId, messageId: message.raw?.message_id ?? message.raw?.client_id, kind: hasMedia(message) ? 'media' : 'text'})
        if (runtime.sealed) deferMaintenance(captured)
        else dispatch(captured)
        return
      }
      if (runtime.sealed) return
      const intent=classifyMessage(message)
      if (intent&&!nativeCommandKind(intent)) {
        if(intent.kind==='session'&&intent.value.action==='steer'&&!message._chatReceipt)message._chatReceipt=jobs.observeSupplement(message,chatThread(message,intent))
        dispatch(message); return
      }
      const token = manager.lifecycle.capture(message.userId)
      void (async () => {
        try {
          await manager.save()
          if (!token.current()) return
          const id = jobs.capture(message,chatThread(message,intent))
          if (id) {
            log('ingress.persisted', {trace_id: message._traceId, messageId: message.raw?.message_id ?? message.raw?.client_id, kind: hasMedia(message) ? 'media' : 'text'})
            dispatch({...message, _ingressId: id, _intakeToken: token})
          }
        } catch (error) {
          log('ingress.persist_failed', {trace_id: message._traceId, ...errorFields(error)})
          try {void Promise.resolve(view.directNotice(message, '消息未能持久保存，请稍后重试。')).catch(() => {})} catch {}
        }
      })()
    },
  }
}
