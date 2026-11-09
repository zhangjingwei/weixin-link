import {WeChatBot} from '@wechatbot/wechatbot'
import {defineInfrastructurePorts} from '../application/ports/infrastructure-ports.mjs'
import {installWeixinProtocol, quoteInput} from './wechat/weixin-protocol.mjs'
import {createWeChatOutbound} from './wechat/wechat-outbound.mjs'
import {confirmedFinalRejection} from './wechat/delivery-evidence.mjs'
import {loadAgentAdapter} from './agents/agent-adapter.mjs'
import {createAgentReadiness} from './agents/agent-readiness.mjs'
import {selectedAgentKind, writeAgentKind} from './agents/agent-selection.mjs'
import {hasMedia, prepareMedia} from './media/media-input.mjs'
import {composeMediaInput} from './media/media-preprocess.mjs'
import {OutputStore, OutputTransport} from './media/outbound-media.mjs'
import {integrationGuidance, integrationStatus, checkIntegration, invokeIntegration} from './integrations/runtime.mjs'
import {RemoteStore} from './storage/registry-lock.mjs'
import {DurableJobs} from './storage/durable-jobs.mjs'

/** Compose existing external implementations without creating another state
 * store. Pass the returned ports into application use cases as needed.
 */
export function createInfrastructurePorts() {
  return defineInfrastructurePorts({
    wechat: {createClient: options => new WeChatBot(options), installProtocol: installWeixinProtocol, quoteInput, createOutbound: createWeChatOutbound, confirmedFinalRejection},
    agent: {load: loadAgentAdapter, readiness: createAgentReadiness, selectedKind: selectedAgentKind, writeKind: writeAgentKind},
    media: {has: hasMedia, prepare: prepareMedia, compose: composeMediaInput,
      outputStore: options => new OutputStore(options), outputTransport: options => new OutputTransport(options)},
    integrations: {guidance: integrationGuidance, status: integrationStatus, check: checkIntegration, invoke: invokeIntegration},
    storage: {registryStore: (root, options) => new RemoteStore(root, options), inbox: path => new DurableJobs(path)},
  })
}
