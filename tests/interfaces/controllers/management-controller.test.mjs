import test from 'node:test'
import assert from 'node:assert/strict'
import {createManagementController} from '../../../src/interfaces/controllers/management-controller.mjs'
import {runConfigurationAction} from '../../../src/setup/config-action.mjs'

test('management setup claims one receipt and does not repeat a recovered operation', async () => {
  const events = [], sent = []
  const management = createManagementController({
    manager: {lifecycle: {capture: () => ({current: () => true, signal: null})}},
    jobs: {acknowledge: ids => events.push(['ack', ids])},
    runtime: {track: async (_kind, work) => work()},
    setupReceipts: {capture: () => ({id: 'receipt'}), claim: () => false, finish: () => {throw Error('must not finish')}},
    setupController: {handle: () => {throw Error('must not execute')}},
    view: {sensitive: () => {throw Error('must not send')}},
    log: () => {},
  })
  await management.setup('status', {userId: 'owner', _recovered: true, _ingressId: 'inbox'}, async text => sent.push(text))
  assert.match(sent[0], /未重复执行/)
  assert.deepEqual(events, [['ack', ['inbox']]])
})

test('configuration entry validates the command boundary and delegates schema reads', async () => {
  const schema = await runConfigurationAction('config-schema', ['ha'])
  assert.equal(schema.properties.version.const, 1)
  await assert.rejects(runConfigurationAction('config-status', ['unexpected']), /CONFIG_ARGUMENTS_INVALID/)
  await assert.rejects(runConfigurationAction('config-set', []), /CONFIG_ARGUMENTS_INVALID/)
})
