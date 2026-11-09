import {systemNotice} from '../core/delivery/system-notice.mjs'

/** WeChat View adapter. Application handlers provide content and delivery
 * options; recipient mapping and SDK-specific response shapes stay here.
 */
export function createMessageView({bot, conversations, outgoing, runtime}) {
  return {
    context(userId, token) {
      if (token) bot.contextStore.set(conversations.recipient(userId), token)
    },
    deliver(userId, value, options) {
      return outgoing.deliver(userId, value, options)
    },
    directNotice(message, text) {
      return runtime.track('delivery', () => bot.reply({...message, userId: conversations.recipient(message.userId)}, systemNotice(text)))
    },
    sensitive(userId, text) {
      return runtime.track('delivery', () => bot.sendSensitiveText(conversations.recipient(userId), text))
    },
  }
}
