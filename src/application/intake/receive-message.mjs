import {errorFields} from '../../core/diagnostics/diagnostic-log.mjs'

/** Persist an ordinary message before it enters the execution queue. */
export function createReceiveMessage({manager, jobs, view, dispatch, hasMedia, log = () => {}}) {
  return {
    async captureBatch(ordinary, setup, setupReceipts) {
      // The caller's beforeCheckpoint hook awaits this whole operation.
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
    captureOrdinary(message) {
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
          void view.directNotice(message, '消息未能持久保存，请稍后重试。').catch(() => {})
        }
      })()
    },
  }
}
