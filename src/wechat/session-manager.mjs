import {SessionManager} from '../application/conversations/session-manager.mjs'
import {createSessionProtocol} from '../infrastructure/agents/session-protocol.mjs'
import {remoteScope} from '../application/remote-tasks/remote-stop.mjs'
import {recoveryText} from '../application/tasks/recovery-state.mjs'
import {integrationGuidance} from '../integrations/runtime.mjs'
import {materialInput} from '../infrastructure/agents/material-context.mjs'
import {flowInput, stripTaskFlow} from '../infrastructure/agents/task-flow.mjs'
import {ASSISTANT_INSTRUCTIONS} from '../infrastructure/agents/assistant-policy.mjs'
import {OutputStore, outputLinks} from '../infrastructure/media/outbound-media.mjs'
import {CancellationScopes} from '../infrastructure/runtime/cancellation-scopes.mjs'
import {installConfig} from '../setup/install-config.mjs'
import {errorFields} from '../infrastructure/diagnostics/diagnostic-log.mjs'
import {deliveryError, deliveryFailureState} from '../infrastructure/wechat/delivery-error.mjs'
import {systemNotice} from '../interfaces/views/system-notice.mjs'
import {controlCommand} from '../interfaces/wechat/control-command.mjs'

// The account composition boundary supplies the shared session engine with
// use-case formatting and external adapters. The engine imports none of them.
export const sessionPorts = Object.freeze({
  assistantInstructions: ASSISTANT_INSTRUCTIONS,
  integrationGuidance, materialInput, flowInput, stripTaskFlow, recoveryText,
  outputStore: options => new OutputStore(options), outputLinks,
  cancellationScopes: () => new CancellationScopes(),
  codexBinary: () => installConfig().codexBinary,
  errorFields, deliveryError, deliveryFailureState, systemNotice, controlCommand,
})

export class ConfiguredSessionManager extends SessionManager {
  constructor(options) {
    const {rpcFactory,providerEnv,sessionProtocol,...rest}=options
    super({sessionPorts, remoteControl: remoteScope, ...rest,sessionProtocol:sessionProtocol??createSessionProtocol({rpcFactory,providerEnv,codexBinary:sessionPorts.codexBinary})})
  }
}
export {ConfiguredSessionManager as SessionManager}
export {controlCommand} from '../interfaces/wechat/control-command.mjs'
export {codexProviderOptions} from '../base/codex/provider-options.mjs'
