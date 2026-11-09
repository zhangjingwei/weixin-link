import test from 'node:test'
import assert from 'node:assert/strict'
import {createWeChatOutbound} from '../../src/infrastructure/wechat/wechat-outbound.mjs'

test('WeChat outbound maps conversation keys at the SDK boundary', async () => {
  const sent = [], tracked = []
  const outbound = createWeChatOutbound({
    bot: {send: async (...args) => {sent.push(['text', ...args]); return {message_id: '1'}}, sendVoice: async (...args) => {sent.push(['voice', ...args]); return {message_id: '2'}}},
    conversations: {recipient: key => key === 'conversation-1' ? 'owner-1' : key},
    runtime: {track: async (kind, work) => {tracked.push(kind); return work()}},
    store: {}, log: () => {},
  })
  assert.deepEqual(await outbound.deliver('conversation-1', 'hello'), {status: 'accepted'})
  await outbound.send('conversation-1', {voice: Buffer.from('voice')})
  assert.deepEqual(sent.map(item => item.slice(0, 2)), [['text', 'owner-1'], ['voice', 'owner-1']])
  assert.deepEqual(tracked, ['delivery', 'delivery'])
})
