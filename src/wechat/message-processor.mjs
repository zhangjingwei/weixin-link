import {createMessageApplication} from '../application/intake/message-application.mjs'
import {createCommandClassifier} from './command-classifier.mjs'
import {voiceCommandInput} from './voice-command-input.mjs'
import {singleMedia} from '../application/intake/single-media.mjs'
import {mediaMessageContext} from '../interfaces/wechat/voice-text.mjs'
import {systemNotice} from '../interfaces/views/system-notice.mjs'
import {codexAvailability} from '../setup/setup-core.mjs'
import {createManagementController} from '../interfaces/controllers/management-controller.mjs'
import {messagePorts} from '../application/ports/message-ports.mjs'

/** Bind the WeChat/media adapters to the transport-neutral message use case. */
export function createMessageProcessor(deps) {
  const ports = messagePorts({infrastructure: deps.infrastructure, delivery: deps.view, stateDir: deps.stateDir, cwd: process.cwd()})
  return createMessageApplication({
    ...deps,
    classifyMessage: deps.classifyMessage ?? createCommandClassifier(),
    management: deps.management ?? createManagementController(deps),
    normalizeVoice: voiceCommandInput,
    hasMedia: ports.media.has,
    singleMedia: (message, token, mediaDependencies) => singleMedia(message, token, mediaDependencies, mediaMessageContext),
    quoteInput: ports.references.quoteInput,
    agentReadiness: deps.agentReadiness ?? ports.agent.checkReady({backend: deps.backend, owners: deps.owners, codexAvailability}),
    diagnosticPackage: ports.media.package,
    confirmedRejection: ports.delivery.confirmedRejection,
    systemNotice,
  })
}
