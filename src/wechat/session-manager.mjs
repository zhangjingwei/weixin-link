import {SessionManager} from '../application/conversations/session-manager.mjs'
import {createSessionProtocol} from '../infrastructure/agents/session-protocol.mjs'
import {integrationGuidance} from '../integrations/runtime.mjs'
import {materialInput} from '../infrastructure/agents/material-context.mjs'
import {flowInput, stripTaskFlow} from '../infrastructure/agents/task-flow.mjs'
import {ASSISTANT_INSTRUCTIONS} from '../infrastructure/agents/assistant-policy.mjs'
import {OutputStore, outputLinks} from '../infrastructure/media/outbound-media.mjs'
import {CancellationScopes} from '../infrastructure/runtime/cancellation-scopes.mjs'
import {errorFields} from '../infrastructure/diagnostics/diagnostic-log.mjs'
import {deliveryError, deliveryFailureState} from '../infrastructure/wechat/delivery-error.mjs'
import {systemNotice} from '../interfaces/views/system-notice.mjs'
import {recoveryControlCommand} from '../interfaces/wechat/control-command.mjs'

// The account composition boundary supplies the shared session engine with
// use-case formatting and external adapters. The engine imports none of them.
const sessionPorts = Object.freeze({
  assistantInstructions: ASSISTANT_INSTRUCTIONS,
  integrationGuidance, materialInput, flowInput, stripTaskFlow,
  outputStore: options => new OutputStore(options), outputLinks,
  cancellationScopes: () => new CancellationScopes(),
  errorFields, deliveryError, deliveryFailureState, systemNotice,
})

class ConfiguredSessionManager extends SessionManager {
  constructor(options) {
    const {rpcFactory,providerEnv,sessionProtocol,...rest}=options
    super({sessionPorts,...rest,sessionProtocol:sessionProtocol??createSessionProtocol({rpcFactory,providerEnv})})
  }
  handle(userId,text,reply,messageId,token,parsedCommand) {
    const command=parsedCommand??(typeof text==='string'?recoveryControlCommand(text):null)
    return super.handle(userId,text,reply,messageId,token,command)
  }
}
export {ConfiguredSessionManager as SessionManager}
