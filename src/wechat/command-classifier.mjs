import {messageIntent} from '../application/intake/message-intent.mjs'
import {hasMedia} from '../infrastructure/media/media-input.mjs'
import {diagnosticCommand} from '../application/diagnostics/diagnostic-commands.mjs'
import {agentSwitchCommand} from '../setup/agent-switch.mjs'
import {chatUpgradeCommand} from '../setup/chat-upgrade.mjs'
import {conversationCommand} from '../interfaces/wechat/conversation-command.mjs'
import {controlCommand} from '../interfaces/wechat/control-command.mjs'

/** Transport-side parser registry; command precedence is defined once. */
export function createCommandClassifier() {
  const parsers = {
    hasMedia,
    diagnostic: (_message, text) => diagnosticCommand(text),
    setup: message => message._setupAction,
    agent: (_message, text) => agentSwitchCommand(text),
    upgrade: (_message, text) => chatUpgradeCommand(text),
    conversation: (_message, text) => conversationCommand(text),
    session: (_message, text) => controlCommand(text),
  }
  return message => messageIntent(message, parsers)
}
