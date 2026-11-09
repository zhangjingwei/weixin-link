import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Readable} from 'node:stream'
import {configure, configPath} from '../../src/setup/config-manager.mjs'
import {createHaClient} from '../../src/integrations/home-assistant/client.mjs'
import {integrationGuidance, integrationStatus, setIntegrationEnabled, invokeIntegration, checkIntegration} from '../../src/integrations/runtime.mjs'
import {runIntegrationCommand} from '../../src/integrations/cli.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'

const id = 'home-assistant'
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'integration-ha-'))
  t.after(() => rm(home, {recursive: true, force: true}))
  const options = {home, account: 'default', env: {}}
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url: String(url), options})
    return {ok: true, json: async () => ({message: 'API running.'})}
  })
  return {options, requests, configure: () => configure('ha', {baseUrl: 'http://ha.example.test:8123', token: 'fixture-token'}, options)}
}

test('fresh install does not require credentials or network and denies invocation', async t => {
  const {options, requests} = await fixture(t)
  assert.equal((await integrationStatus(options))[0].enabled, false)
  assert.equal(await integrationGuidance(options), '')
  await assert.rejects(invokeIntegration(id, {operation: 'states'}, options), /INTEGRATION_DISABLED/)
  await assert.rejects(setIntegrationEnabled(id, true, options), /INTEGRATION_CONFIG_REQUIRED/)
  assert.equal(requests.length, 0)
})
test('legacy HA config remains compatible but does not implicitly authorize any account', async t => {
  const {options, requests, configure} = await fixture(t)
  await configure()
  assert.equal(requests.length, 1)
  assert.equal((await integrationStatus(options))[0].enabled, false)
  await setIntegrationEnabled(id, true, options)
  assert.equal((await integrationStatus(options))[0].valid, true)
  const guidance = await integrationGuidance(options)
  assert.match(guidance, /Home Assistant/)
  assert.ok(guidance.includes(fileURLToPath(new URL('../../', import.meta.url))))
  assert.ok(!guidance.includes('fixture-token'))
  assert.ok(!guidance.includes('ha.example.test'))
  const bot2 = {...options, account: 'bot2'}
  assert.equal(await integrationGuidance(bot2), '')
  await assert.rejects(checkIntegration(id, bot2), /INTEGRATION_DISABLED/)
  await assert.rejects(invokeIntegration(id, {operation: 'states'}, bot2), /INTEGRATION_DISABLED/)
})
test('disable revokes future calls immediately and succeeds with missing or invalid HA configuration', async t => {
  const {options, requests, configure} = await fixture(t)
  await configure(); await setIntegrationEnabled(id, true, options)
  await writeFile(configPath('ha', options), '{broken fixture-token')
  const before = requests.length
  await setIntegrationEnabled(id, false, options)
  assert.equal(await integrationGuidance(options), '')
  await assert.rejects(invokeIntegration(id, {operation: 'states'}, options), /INTEGRATION_DISABLED/)
  assert.equal(requests.length, before)
})
test('failed health check never enables integration and redacts service errors', async t => {
  const {options, configure} = await fixture(t)
  await configure()
  t.mock.method(globalThis, 'fetch', async () => {throw Error('fixture-token private-url')})
  await assert.rejects(setIntegrationEnabled(id, true, options), {message: 'INTEGRATION_HEALTH_FAILED'})
  assert.equal((await integrationStatus(options))[0].enabled, false)
})
test('malformed account policy fails closed without breaking ordinary session guidance', async t => {
  const {options} = await fixture(t)
  const stateDir = join(options.home, 'isolated-state')
  await mkdir(stateDir)
  await writeFile(join(stateDir, 'integrations.json'), '{fixture-token')
  assert.equal(await integrationGuidance({...options, stateDir}), '')
  const manager = new SessionManager({stateDir, cwd: options.home, owners: []})
  assert.equal(await manager.sessionInstructions(), manager.instructions)
  await assert.rejects(invokeIntegration(id, {operation: 'states'}, {...options, stateDir}), /INTEGRATION_POLICY_INVALID/)
})
test('unsupported methods cannot trigger network requests, and call failures are redacted', async t => {
  const {options, requests, configure} = await fixture(t)
  await configure(); await setIntegrationEnabled(id, true, options)
  const before = requests.length
  for (const operation of ['call_service', 'POST', '../services/light/turn_on']) {
    await assert.rejects(invokeIntegration(id, {operation}, options), /INTEGRATION_OPERATION_NOT_ALLOWED/)
  }
  await assert.rejects(invokeIntegration(id, {operation: 'states', url: '/api/services'}, options), /INTEGRATION_ARGUMENTS_INVALID/)
  assert.equal(requests.length, before)
  t.mock.method(globalThis, 'fetch', async () => {throw Error('fixture-token')})
  await assert.rejects(invokeIntegration(id, {operation: 'states'}, options), {message: 'INTEGRATION_CALL_FAILED'})
})
test('health and history use only GET, fixed URLs, redirect rejection and bounded timeouts', async t => {
  const calls = []
  const client = createHaClient({baseUrl: 'http://ha.example.test', token: 'fixture-token'}, {
    fetchImpl: async (url, options) => {
      calls.push({url: String(url), options})
      return {ok: true, json: async () => calls.length === 1 ? {} : [[{state: 'unknown', last_updated: '2026-01-01T00:00:00Z'}, {state: '23', last_changed: '2026-01-01T01:00:00Z'}]]}
    },
  })
  await client.health()
  const result = await client.history('sensor.temperature', 24)
  assert.equal(result.records[0].state, 'unknown')
  assert.equal(result.count, 2)
  assert.equal(new URL(calls[1].url).searchParams.get('filter_entity_id'), 'sensor.temperature')
  for (const {options} of calls) {
    assert.equal(options.method ?? 'GET', 'GET')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
  }
  await assert.rejects(client.history('../services/light/turn_on', 24))
  for (const hours of [0, 169, NaN]) await assert.rejects(client.history('sensor.temperature', hours))
  assert.equal(calls.length, 2)
})
test('states retain useful readings when optional room metadata is unavailable', async () => {
  const client = createHaClient({baseUrl: 'http://ha.example.test', token: 'fixture-token'}, {
    fetchImpl: async () => ({ok: true, json: async () => [
      {entity_id: 'sensor.temperature', state: '22', attributes: {friendly_name: '书房 温度', unit_of_measurement: '°C', secret: 'excluded'}},
      {entity_id: 'automation.private', state: 'on', attributes: {}},
    ]}),
    WebSocketImpl: class {constructor() {throw Error('unavailable')}},
  })
  const result = await client.states('书房')
  assert.equal(result.count, 1)
  assert.equal(result.warning, 'HA_REGISTRY_UNAVAILABLE')
  assert.equal(result.entities[0].attributes.secret, undefined)
  assert.equal(result.entities[0].area, null)
})
test('setup integration command routes structured input and rejects arbitrary commands', async t => {
  const {options} = await fixture(t)
  const previous = process.env.HOME
  process.env.HOME = options.home
  t.after(() => { if(previous === undefined) delete process.env.HOME; else process.env.HOME = previous })
  assert.equal((await runIntegrationCommand('list', ['default']))[0].enabled, false)
  await assert.rejects(runIntegrationCommand('call', [id, 'default'], Readable.from(['{"operation":"states"}'])), /INTEGRATION_DISABLED/)
  await assert.rejects(runIntegrationCommand('shell', [id]), /INTEGRATION_ARGUMENTS_INVALID/)
  await assert.rejects(runIntegrationCommand('enable', ['../../etc']), /INTEGRATION_UNKNOWN/)
})
test('configured enabled guidance is injected on connection, excluded for other accounts and remote backends', async t => {
  const {options, configure} = await fixture(t)
  await configure(); await setIntegrationEnabled(id, true, options)
  const previous = process.env.HOME
  process.env.HOME = options.home
  t.after(() => {if(previous === undefined) delete process.env.HOME; else process.env.HOME = previous})
  const stateDir = join(options.home, '.local/share/wechat-ping-bot')
  const manager = new SessionManager({stateDir, cwd: options.home, owners: []})
  assert.match(await manager.sessionInstructions(), /Home Assistant/)
  const host = new SessionManager({stateDir, cwd: options.home, owners: [], backend: {kind: 'host'}})
  assert.match(await host.sessionInstructions(), /Home Assistant/)
  const other = new SessionManager({stateDir: join(stateDir, 'accounts/bot2'), cwd: options.home, owners: []})
  assert.equal(await other.sessionInstructions(), other.instructions)
  const remote = new SessionManager({stateDir, cwd: options.home, owners: [], backend: {workspace: options.home}})
  assert.equal(await remote.sessionInstructions(), remote.instructions)
  await setIntegrationEnabled(id, false, options)
  assert.equal(await manager.sessionInstructions(), manager.instructions)
})
