import {systemNotice} from '../../core/delivery/system-notice.mjs'

/** WeChat View adapter. Application handlers provide content and delivery
 * options; recipient mapping and SDK-specific response shapes stay here.
 */
export function createWeChatPresenter({bot, conversations, outgoing, runtime}) {
  const rawDeliver = outgoing.deliver.bind(outgoing)
  conversations.sendOutput = rawDeliver
  const deliver = (userId, value, options) => conversations.deliver(
    userId,
    options?.conversationControl ? systemNotice(value) : value,
    options,
    rawDeliver,
  )
  return {
    context(userId, token) {
      if (token) bot.contextStore.set(conversations.recipient(userId), token)
    },
    deliver,
    notice(userId, text, options) {
      return deliver(userId, text, {...options, conversationControl: true})
    },
    announcement(userId, text) {
      return conversations.serialize(userId, async () => {
        await runtime.track('delivery', () => bot.sendAnnouncement(userId, systemNotice(text)))
        return {status: 'accepted'}
      })
    },
    directNotice(message, text) {
      return runtime.track('delivery', () => bot.reply({...message, userId: conversations.recipient(message.userId)}, systemNotice(text)))
    },
    sensitive(userId, text) {
      return runtime.track('delivery', () => bot.sendSensitiveText(conversations.recipient(userId), text))
    },
  }
}
