import {OutputTransport} from '../media/outbound-media.mjs'

/** Bind the WeChat SDK send operations to the existing account-scoped output
 * ledger. OutputTransport keeps its accepted, failed and unknown semantics.
 */
export function createWeChatOutbound({bot, conversations, runtime, store, log}) {
  return new OutputTransport({
    store, log,
    send: (key, content) => runtime.track('delivery', () => {
      const recipient = conversations.recipient(key)
      return content?.voice ? bot.sendVoice(recipient, content.voice) : bot.send(recipient, content)
    }),
  })
}
