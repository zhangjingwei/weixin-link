import {messageIntent} from '../core/intake/message-intent.mjs'
import {hasMedia} from '../media/media-input.mjs'
import {diagnosticCommand} from '../core/diagnostics/diagnostic-commands.mjs'
import {agentSwitchCommand} from '../setup/agent-switch.mjs'
import {chatUpgradeCommand} from '../setup/chat-upgrade.mjs'
import {conversationCommand} from '../core/text-conversations.mjs'
import {controlCommand} from '../base/codex/control-command.mjs'

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
