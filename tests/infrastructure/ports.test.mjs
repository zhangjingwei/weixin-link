import test from 'node:test'
import assert from 'node:assert/strict'
import {defineInfrastructurePorts} from '../../src/application/ports/infrastructure-ports.mjs'
import {messagePorts} from '../../src/application/ports/message-ports.mjs'
import {createInfrastructurePorts} from '../../src/wechat/infrastructure-ports.mjs'
import {installWeixinProtocol as legacyProtocol} from '../../src/wechat/weixin-protocol.mjs'
import {loadAgentAdapter as legacyAgent} from '../../src/infrastructure/agents/agent-adapter.mjs'
import {selectedAgentKind as legacySelection} from '../../src/infrastructure/agents/agent-selection.mjs'
import {prepareMedia as mediaImplementation} from '../../src/infrastructure/media/media-input.mjs'
import {integrationGuidance as legacyGuidance} from '../../src/integrations/runtime.mjs'
import {RemoteStore as LegacyStore} from '../../src/infrastructure/storage/registry-lock.mjs'

test('external ports expose the migrated implementations without copying state', () => {
  const ports = createInfrastructurePorts()
  assert.equal(ports.wechat.installProtocol, legacyProtocol)
  assert.equal(ports.wechat.confirmedFinalRejection({delivery_error: {api_code: -2}}), true)
  assert.equal(ports.wechat.confirmedFinalRejection({delivery_error: {api_code: 19001}}), false)
  assert.equal(ports.agent.load, legacyAgent)
  assert.equal(ports.agent.selectedKind, legacySelection)
  assert.equal(ports.media.prepare, mediaImplementation)
  assert.equal(ports.integrations.guidance, legacyGuidance)
  assert.ok(ports.storage.registryStore('/tmp') instanceof LegacyStore)
  assert.ok(Object.isFrozen(ports))
  assert.ok(Object.isFrozen(ports.media))
})

test('port contract refuses incomplete implementations', () => {
  assert.throws(() => defineInfrastructurePorts({}), /INFRASTRUCTURE_PORT_INVALID/)
  const ports = createInfrastructurePorts()
  assert.throws(() => defineInfrastructurePorts({...ports, media: {has: () => false}}), /INFRASTRUCTURE_PORT_INVALID/)
})

test('message use case receives narrow functions rather than an SDK client factory', () => {
  const ports = messagePorts({infrastructure: createInfrastructurePorts(), delivery: {deliver: async () => ({status: 'accepted'})}, stateDir: '/tmp/test-account', cwd: '/tmp/test-workspace'})
  assert.equal(typeof ports.media.prepare, 'function')
  assert.equal(typeof ports.agent.checkReady, 'function')
  assert.equal(typeof ports.delivery.deliver, 'function')
  assert.equal(typeof ports.delivery.confirmedRejection, 'function')
  assert.equal(typeof ports.media.package, 'function')
  assert.equal(ports.media.outputStore, undefined)
  assert.equal(ports.references.createClient, undefined)
  assert.equal(ports.agent.load, undefined)
  assert.throws(() => messagePorts({infrastructure: {}, delivery: {}}), /MESSAGE_PORT_INVALID/)
})
