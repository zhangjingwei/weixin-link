import {voiceCommandInput} from './voice-command-input.mjs'
import {hasMedia} from '../media/media-input.mjs'
import {errorFields} from '../core/diagnostics/diagnostic-log.mjs'

/** WeChat controller: converts SDK callbacks into captured application messages.
 * The protocol's beforeCheckpoint hook awaits prepareBatch, so failures must
 * propagate instead of advancing the polling cursor.
 */
export function createInboundController({bot, view, manager, jobs, conversations, runtime, setupController, setupReceipts, classifyMessage, traceWire, traceMessage, quote, dispatch, log = () => {}}) {
  const stagedWires = new WeakMap()
  const originalParse = bot.parser.parse.bind(bot.parser)
  bot.parser.parse = wire => stagedWires.get(wire) ?? originalParse(wire)

  async function prepareBatch(wires) {
    if (runtime.sealed) throw Error('INGRESS_SEALED')
    const received = [], setupReceived = []
    for (const wire of wires) {
      const parsed = originalParse(wire)
      if (!parsed || !conversations.realOwners.has(parsed.userId)) continue
      const previous = jobs.findCaptured(parsed)
      const message = previous ?? conversations.bind(voiceCommandInput(parsed))
      message._traceId ??= traceWire(wire)
      const frozenSetup = setupReceipts.get(parsed)
      if (frozenSetup) {
        message._setupAction = frozenSetup.action
        message._setupReceiptId = frozenSetup.id
      }
      if (!Object.hasOwn(message, '_setupAction')) message._setupAction = previous ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
      message.references ??= quote(message)
      stagedWires.set(wire, message)
      if (message._setupAction) setupReceived.push(message)
      if (!classifyMessage(message)) received.push(message)
    }
    await manager.save()
    for (const message of received) jobs.capture(message)
    for (const message of setupReceived) {
      message._ingressId = jobs.capture(message) ?? message._ingressId
      const receipt = setupReceipts.capture(message)
      if (receipt) {
        message._setupAction = receipt.action
        message._setupReceiptId = receipt.id
      }
    }
  }

  function onMessage(message) {
    const inboundTrace = traceMessage(message)
    message._traceId ??= inboundTrace
    if (!conversations.realOwners.has(message._conversationOwner ?? message.userId) || runtime.sealed) return
    message = voiceCommandInput(message)
    if (!message._conversationOwner) message = conversations.bind(message)
    if (!Object.hasOwn(message, '_setupAction')) message._setupAction = message._recovered ? null : setupController.command(message.text, message._conversationOwner ?? message.userId, message.userId)
    if (classifyMessage(message)) { dispatch(message); return }
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
  }

  return {prepareBatch, onMessage}
}
