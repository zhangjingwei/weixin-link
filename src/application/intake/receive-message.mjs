import {errorFields} from '../../infrastructure/diagnostics/diagnostic-log.mjs'

/** Own receipt and fast-control decisions after the transport parses a wire. */
export function createReceiveMessage({manager, jobs, view, dispatch, hasMedia, conversations, runtime, setupController, setupReceipts, normalizeVoice, classifyMessage, log = () => {}}) {
  const startsAgentTask=message=>['plan','review'].includes(classifyMessage(message)?.value?.action)
  return {
    prepare(parsed, {traceId, quote}) {
      const previous = jobs.findCaptured(parsed)
      const message = previous ?? conversations.bind(normalizeVoice(parsed))
      message._traceId ??= traceId
      const frozenSetup = setupReceipts.get(parsed)
      if (frozenSetup) {
        message._setupAction = frozenSetup.action
        message._setupReceiptId = frozenSetup.id
      }
      if (!Object.hasOwn(message, '_setupAction')) message._setupAction = previous ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
      message.references ??= quote(message)
      return message
    },
    async captureBatch(messages) {
      // beforeCheckpoint awaits this whole operation; failure blocks the cursor.
      const ordinary = messages.filter(message => !classifyMessage(message)||startsAgentTask(message))
      const setup = messages.filter(message => message._setupAction)
      await manager.save()
      for (const message of ordinary) jobs.capture(message)
      for (const message of setup) {
        message._ingressId = jobs.capture(message) ?? message._ingressId
        const receipt = setupReceipts.capture(message)
        if (receipt) {
          message._setupAction = receipt.action
          message._setupReceiptId = receipt.id
        }
      }
    },
    onMessage(message) {
      if (message._inboxBackend && message._inboxBackend !== jobs.backendKey) return
      if (!conversations.realOwners.has(message._conversationOwner ?? message.userId) || runtime.sealed) return
      message = normalizeVoice(message)
      if (!message._conversationOwner) message = conversations.bind(message)
      if (!Object.hasOwn(message, '_setupAction')) message._setupAction = message._recovered ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
      if (classifyMessage(message)&&!startsAgentTask(message)) { dispatch(message); return }
      const token = manager.lifecycle.capture(message.userId)
      void (async () => {
        try {
          await manager.save()
          if (!token.current()) return
          const id = jobs.capture(message)
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
