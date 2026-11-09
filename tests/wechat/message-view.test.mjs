import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageView} from '../../src/wechat/message-view.mjs'

test('WeChat view maps conversation keys only at the SDK boundary', async () => {
  const calls = []
  const bot = {
    contextStore: new Map(),
    reply: async (message, text) => calls.push(['reply', message.userId, text]),
    sendSensitiveText: async (userId, text) => calls.push(['sensitive', userId, text]),
    sendAnnouncement: async (userId, text) => calls.push(['announcement', userId, text]),
  }
  const conversations = {recipient: () => 'real-peer', deliver: (key, value, options, send) => send(key, value, options), serialize: (_key, work) => work()}
  const view = createMessageView({bot, conversations,
    outgoing: {deliver: async (key, value) => calls.push(['deliver', key, value])},
    runtime: {track: async (_kind, work) => work()}})
  view.context('conversation-key', 'context-token')
  await view.deliver('conversation-key', 'answer')
  await view.directNotice({userId: 'conversation-key'}, 'maintenance')
  await view.sensitive('conversation-key', 'private prompt')
  await view.notice('conversation-key', 'scheduled')
  await view.announcement('real-peer', 'welcome')
  assert.equal(bot.contextStore.get('real-peer'), 'context-token')
  assert.equal(typeof conversations.sendOutput, 'function')
  assert.deepEqual(calls[0], ['deliver', 'conversation-key', 'answer'])
  assert.equal(calls[1][1], 'real-peer')
  assert.match(calls[1][2], /maintenance/)
  assert.deepEqual(calls[2], ['sensitive', 'real-peer', 'private prompt'])
  assert.match(calls[3][2], /scheduled.*系统通知/s)
  assert.match(calls[4][2], /welcome.*系统通知/s)
})
