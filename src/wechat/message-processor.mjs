import {createMessageApplication} from '../core/intake/message-application.mjs'
import {createCommandClassifier} from './command-classifier.mjs'
import {voiceCommandInput} from './voice-command-input.mjs'
import {hasMedia} from '../media/media-input.mjs'
import {singleMedia} from '../media/single-media.mjs'
import {quoteInput} from './weixin-protocol.mjs'
import {codexAvailability} from '../setup/setup-core.mjs'
import {OutputStore} from '../media/outbound-media.mjs'

/** Bind the WeChat/media adapters to the transport-neutral message use case. */
export function createMessageProcessor(deps) {
  return createMessageApplication({
    ...deps,
    classifyMessage: deps.classifyMessage ?? createCommandClassifier(),
    normalizeVoice: voiceCommandInput,
    hasMedia,
    singleMedia,
    quoteInput,
    codexAvailability,
    claudeCredentialsAvailable: () => !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX || process.env.CLAUDE_CODE_USE_FOUNDRY),
    diagnosticPackage: (userId, value) => new OutputStore({stateDir: deps.stateDir, cwd: process.cwd()}).package(userId, value),
  })
}
