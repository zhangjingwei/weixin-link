import test from 'node:test'
import assert from 'node:assert/strict'
import {createInboundController} from '../../src/wechat/inbound-controller.mjs'

function fixture() {
  const captured = [], dispatched = [], replies = [], events = []
  const token = {current: () => true}
  const bot = {parser: {parse: wire => wire.message}, reply: async (...args) => replies.push(args)}
  const manager = {save: async () => events.push('save'), lifecycle: {capture: () => token}}
  const jobs = {findCaptured: () => null, capture: message => {events.push('capture'); captured.push(message); return 'inbox-1'}}
  const conversations = {realOwners: new Set(['owner']), bind: message => message, recipient: owner => owner}
  const runtime = {sealed: false}
  const setupController = {command: () => null}
  const setupReceipts = {get: () => null, capture: () => null}
  const controller = createInboundController({bot, manager, jobs, conversations, runtime, setupController, setupReceipts,
    classifyMessage: message => message.text === '停止' ? {kind: 'session', value: {action: 'stop'}} : null,
    traceWire: () => 'wire-trace', traceMessage: () => {events.push('trace'); return 'message-trace'}, quote: () => [],
    dispatch: message => dispatched.push(message), log: () => {}})
  return {controller, bot, manager, jobs, runtime, captured, dispatched, replies, events}
}

test('SDK batch capture saves before inbox insertion and reuses staged message', async () => {
  const f = fixture(), wire = {message: {userId: 'owner', text: '普通任务', raw: {message_id: 'external-1'}}}
  await f.controller.prepareBatch([wire])
  assert.deepEqual(f.events, ['save', 'capture'])
  assert.equal(f.bot.parser.parse(wire), f.captured[0])
  assert.equal(f.captured[0]._traceId, 'wire-trace')
  f.controller.onMessage(f.bot.parser.parse(wire))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.events.includes('trace'), true)
  assert.equal(f.dispatched.length, 1)
  assert.equal(f.dispatched[0]._ingressId, 'inbox-1')
  assert.equal(f.captured.length, 2)
})

test('failed pre-checkpoint save does not capture or advance the batch', async () => {
  const f = fixture()
  f.manager.save = async () => {throw Error('disk unavailable')}
  await assert.rejects(f.controller.prepareBatch([{message: {userId: 'owner', text: '普通任务'}}]), /disk unavailable/)
  assert.equal(f.captured.length, 0)
})

test('controls bypass ordinary inbox capture and unauthorized messages are ignored', async () => {
  const f = fixture()
  f.controller.onMessage({userId: 'owner', text: '停止'})
  f.controller.onMessage({userId: 'other', text: '普通任务'})
  assert.equal(f.dispatched.length, 1)
  assert.equal(f.dispatched[0].text, '停止')
  assert.equal(f.captured.length, 0)
})

test('failed ordinary capture reports failure and never dispatches', async () => {
  const f = fixture()
  f.jobs.capture = () => {throw Error('disk unavailable')}
  f.controller.onMessage({userId: 'owner', text: '普通任务'})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.dispatched.length, 0)
  assert.equal(f.replies.length, 1)
  assert.match(f.replies[0][1], /未能持久保存/)
})
