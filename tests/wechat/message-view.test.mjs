import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageView} from '../../src/wechat/message-view.mjs'

test('WeChat view maps conversation keys only at the SDK boundary', async () => {
  const calls = []
  const bot = {
    contextStore: new Map(),
    reply: async (message, text) => calls.push(['reply', message.userId, text]),
    sendSensitiveText: async (userId, text) => calls.push(['sensitive', userId, text]),
  }
  const view = createMessageView({bot, conversations: {recipient: () => 'real-peer'},
    outgoing: {deliver: async (key, value) => calls.push(['deliver', key, value])},
    runtime: {track: async (_kind, work) => work()}})
  view.context('conversation-key', 'context-token')
  await view.deliver('conversation-key', 'answer')
  await view.directNotice({userId: 'conversation-key'}, 'maintenance')
  await view.sensitive('conversation-key', 'private prompt')
  assert.equal(bot.contextStore.get('real-peer'), 'context-token')
  assert.deepEqual(calls[0], ['deliver', 'conversation-key', 'answer'])
  assert.equal(calls[1][1], 'real-peer')
  assert.match(calls[1][2], /maintenance/)
  assert.deepEqual(calls[2], ['sensitive', 'real-peer', 'private prompt'])
})
