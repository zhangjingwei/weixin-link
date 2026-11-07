import {voiceTextMessage} from '../media/voice-text.mjs'
import {conversationCommand} from '../core/conversations/commands.mjs'
import {controlCommand} from '../base/codex/control-command.mjs'
import {diagnosticCommand} from '../core/diagnostics/diagnostic-commands.mjs'
import {setupCommand} from '../setup/setup-controller.mjs'
import {agentSwitchCommand} from '../setup/agent-switch.mjs'
import {chatUpgradeCommand} from '../setup/chat-upgrade.mjs'

// Normalize before binding and queue selection. Keep the original wire record.
export function voiceCommandInput(message){
 const converted=voiceTextMessage(message)
 if(!converted)return message
 const candidate=converted.text.trim().replace(/[。！？!?，,]+$/u,'').trim()
 const conversation=conversationCommand(candidate),control=controlCommand(candidate)
 // Free-form arguments (names, search queries, answers and supplements) keep punctuation.
 const command=(conversation&&!conversation.name&&!conversation.q&&!conversation.workspace)||(control&&!['steer','answer'].includes(control.action))||diagnosticCommand(candidate)||setupCommand(candidate)||agentSwitchCommand(candidate)||chatUpgradeCommand(candidate)
 return {...converted,text:command?candidate:converted.text,_voiceTranscribed:true}
}
