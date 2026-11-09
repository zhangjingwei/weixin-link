import {SessionManager} from '../base/codex/codex-session.mjs'
import {remoteScope} from '../application/remote-tasks/remote-stop.mjs'
import {recoveryText} from '../application/tasks/recovery-state.mjs'
import {integrationGuidance} from '../infrastructure/integrations/runtime.mjs'
import {materialInput} from '../infrastructure/agents/material-context.mjs'
import {flowInput, stripTaskFlow} from '../infrastructure/agents/task-flow.mjs'
import {ASSISTANT_INSTRUCTIONS} from '../infrastructure/agents/assistant-policy.mjs'
import {OutputStore, outputLinks} from '../infrastructure/media/outbound-media.mjs'
import {errorFields} from '../infrastructure/diagnostics/diagnostic-log.mjs'
import {deliveryError, deliveryFailureState} from '../infrastructure/wechat/delivery-error.mjs'
import {systemNotice} from '../interfaces/views/system-notice.mjs'

// The account composition boundary supplies the shared session engine with
// use-case formatting and external adapters. The engine imports none of them.
export const sessionPorts = Object.freeze({
  assistantInstructions: ASSISTANT_INSTRUCTIONS,
  integrationGuidance, materialInput, flowInput, stripTaskFlow, recoveryText,
  outputStore: options => new OutputStore(options), outputLinks,
  errorFields, deliveryError, deliveryFailureState, systemNotice,
})

export class ConfiguredSessionManager extends SessionManager {
  constructor(options) {
    super({sessionPorts, remoteControl: remoteScope, ...options})
  }
}
export {ConfiguredSessionManager as SessionManager}
export {controlCommand, codexProviderOptions} from '../base/codex/codex-session.mjs'
