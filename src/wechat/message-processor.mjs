import {createMessageApplication} from '../core/intake/message-application.mjs'
import {createCommandClassifier} from './command-classifier.mjs'
import {voiceCommandInput} from './voice-command-input.mjs'
import {hasMedia} from '../media/media-input.mjs'
import {singleMedia} from '../media/single-media.mjs'
import {quoteInput} from './weixin-protocol.mjs'
import {codexAvailability} from '../setup/setup-core.mjs'
import {createAgentReadiness} from '../base/agent-readiness.mjs'
import {createChatManagement} from '../setup/chat-management.mjs'
import {OutputStore} from '../media/outbound-media.mjs'

/** Bind the WeChat/media adapters to the transport-neutral message use case. */
export function createMessageProcessor(deps) {
  return createMessageApplication({
    ...deps,
    classifyMessage: deps.classifyMessage ?? createCommandClassifier(),
    management: deps.management ?? createChatManagement(deps),
    normalizeVoice: voiceCommandInput,
    hasMedia,
    singleMedia,
    quoteInput,
    agentReadiness: deps.agentReadiness ?? createAgentReadiness({backend: deps.backend, owners: deps.owners, codexAvailability}),
    diagnosticPackage: (userId, value) => new OutputStore({stateDir: deps.stateDir, cwd: process.cwd()}).package(userId, value),
  })
}
