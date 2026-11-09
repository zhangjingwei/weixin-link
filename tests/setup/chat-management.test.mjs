import test from 'node:test'
import assert from 'node:assert/strict'
import {createChatManagement} from '../../src/setup/chat-management.mjs'

test('management setup claims one receipt and does not repeat a recovered operation', async () => {
  const events = [], sent = []
  const management = createChatManagement({
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

test('management switch failure uses a bounded public code and acknowledges once', async () => {
  const events = [], sent = []
  const management = createChatManagement({
    jobs: {acknowledge: ids => events.push(['ack', ids])},
    runtime: {track: async (_kind, work) => work()},
    agentSwitcher: {handle: async () => {throw Error('secret details: token=private')}},
    view: {},
    log: (event, fields) => events.push([event, fields]),
  })
  await management.agent({action: 'switch'}, {userId: 'owner', _ingressId: 'inbox'}, async text => sent.push(text), 'trace-1')
  assert.match(sent[0], /AGENT_SWITCH_FAILED/)
  assert.doesNotMatch(sent[0], /private/)
  assert.deepEqual(events.at(-1), ['ack', ['inbox']])
})
