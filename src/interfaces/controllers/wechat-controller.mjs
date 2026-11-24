import {hasMedia} from '../../infrastructure/media/media-input.mjs'
import {createReceiveMessage} from '../../application/intake/receive-message.mjs'
import {requireExternalMessageId} from '../../infrastructure/storage/ingress-envelope.mjs'

/** WeChat controller: converts SDK callbacks into captured application messages.
 * The protocol's beforeCheckpoint hook awaits prepareBatch, so failures must
 * propagate instead of advancing the polling cursor.
 */
export function createWeChatController({bot, view, manager, jobs, conversations, runtime, setupController, setupReceipts, classifyMessage, normalizeVoice, traceWire, traceMessage, quote, dispatch, deferMaintenance, phoneAccess, log = () => {}}) {
  const stagedWires = new WeakMap()
  const admitted = new WeakSet()
  const receive = createReceiveMessage({manager, jobs, view, dispatch, deferMaintenance, hasMedia, conversations, runtime, setupController, setupReceipts, normalizeVoice, classifyMessage, log})
  const originalParse = bot.parser.parse.bind(bot.parser)
  bot.parser.parse = wire => stagedWires.get(wire) ?? originalParse(wire)

  async function prepareBatch(wires) {
    if (runtime.sealed) throw Error('INGRESS_SEALED')
    const parsedWires = wires.map(wire => ({wire, parsed: originalParse(wire)}))
      .filter(({parsed}) => parsed && conversations.realOwners.has(parsed.userId))
    // Validate the full batch before bind() can mutate conversation selection.
    for (const {parsed} of parsedWires) requireExternalMessageId(parsed)
    const messages = []
    for (const {wire, parsed} of parsedWires) {
      const handled=phoneAccess?.(parsed,jobs,hasMedia)
      if(handled){stagedWires.set(wire,{...parsed,_companion:handled});continue}
      const message = receive.prepare(parsed, {traceId: traceWire(wire), quote})
      admitted.add(message)
      stagedWires.set(wire, message)
      messages.push(message)
    }
    await receive.captureBatch(messages)
  }

  function onMessage(message) {
    if(!conversations.realOwners.has(message._conversationOwner??message.userId))return
    if(phoneAccess&&!message._companion&&!admitted.has(message)){
      const handled=phoneAccess(message,jobs,hasMedia)
      if(handled)message={...message,_companion:handled}
    }
    if(message._companion){if(message._companion.notice)return view.directNotice(message,message._companion.notice);return}
    const inboundTrace = traceMessage(message)
    message._traceId ??= inboundTrace
    receive.onMessage(message)
  }

  return {prepareBatch, onMessage}
}
