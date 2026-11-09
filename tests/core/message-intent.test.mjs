import test from 'node:test'
import assert from 'node:assert/strict'
import {messageIntent} from '../../src/core/intake/message-intent.mjs'

test('intent classification has one ordered rule and ignores media', () => {
  const calls = []
  const parsers = {hasMedia: message => !!message.media}
  for (const kind of ['diagnostic', 'setup', 'agent', 'upgrade', 'conversation', 'session']) parsers[kind] = () => {calls.push(kind); return kind === 'agent' ? {action: 'switch'} : null}
  assert.deepEqual(messageIntent({text: '切换智能体'}, parsers), {kind: 'agent', value: {action: 'switch'}})
  assert.deepEqual(calls, ['diagnostic', 'setup', 'agent'])
  calls.length = 0
  assert.equal(messageIntent({text: '切换智能体', media: true}, parsers), null)
  assert.deepEqual(calls, [])
})
