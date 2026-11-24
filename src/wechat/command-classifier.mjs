import {messageIntent} from '../application/intake/message-intent.mjs'
import {hasMedia} from '../infrastructure/media/media-input.mjs'
import {diagnosticCommand} from '../application/diagnostics/diagnostic-commands.mjs'
import {conversationCommand} from '../interfaces/wechat/conversation-command.mjs'
import {controlCommand} from '../interfaces/wechat/control-command.mjs'

/** Transport-side parser registry; command precedence is defined once. */
export function createCommandClassifier() {
  const parsers = {
    hasMedia,
    diagnostic: (_message, text) => diagnosticCommand(text),
    setup: message => message._setupAction,
    conversation: (message, text) => Object.hasOwn(message,'_conversationCommand')?message._conversationCommand:conversationCommand(text),
    session: (message, text) => message._sessionCommand??controlCommand(text),
  }
  return message => messageIntent(message, parsers)
}
