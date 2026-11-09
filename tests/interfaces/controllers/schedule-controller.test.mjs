import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createScheduleController} from '../../../src/interfaces/controllers/schedule-controller.mjs'

test('schedule controller routes due reminders to the presenter and tasks to the owned queue', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'schedule-controller-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  let now = Date.parse('2026-11-06T12:00:00Z')
  const notices = [], submissions = []
  const controller = await createScheduleController({
    stateDir, owners: ['alice'], ready: () => true, track: work => work(), now: () => now,
    manager: {sessions: new Map([['alice', {userId: 'alice', threadId: 'thread-alice'}]])},
    conversations: {recipient: key => key, realOwners: new Set(['alice']), entry: key => ({owner: key})},
    enqueueTask: (...args) => {submissions.push(args); return 'job-1'},
    agent: {kind: 'codex'}, backend: {kind: 'host'},
    view: {notice: async (...args) => {notices.push(args); return {status: 'accepted'}}},
    log: () => {},
  })
  const at = new Date(now + 1000).toISOString()
  await controller.onRequest({action: 'create', threadId: 'thread-alice', kind: 'reminder', at, text: '喝水'})
  await controller.onRequest({action: 'create', threadId: 'thread-alice', kind: 'task', at, text: '汇总新闻'})
  now += 1000
  await controller.tick()
  assert.deepEqual(notices, [['alice', '⏰ 提醒：喝水']])
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0][0], 'alice')
  assert.deepEqual(submissions[0][1], {text: '汇总新闻'})
  assert.match(submissions[0][2], /^schedule:/)
  assert.deepEqual(controller.onRequest({action: 'list', threadId: 'thread-alice'}).items.map(item => item.status), ['accepted', 'accepted'])
  controller.close()
})

test('scheduled tasks enter the same queue regardless of selected agent and execution backend', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'schedule-controller-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  let now = Date.parse('2026-11-06T12:00:00Z')
  const submissions = []
  const controller = await createScheduleController({
    stateDir, owners: ['alice'], ready: () => true, track: work => work(), now: () => now,
    manager: {sessions: new Map([['alice', {userId: 'alice', threadId: 'thread-alice'}]])},
    conversations: {recipient: key => key, realOwners: new Set(['alice']), entry: key => ({owner: key})},
    enqueueTask: (...args) => {submissions.push(args); return 'queued-claude'},
    agent: {kind: 'claude'}, backend: {kind: 'podman'}, view: {notice: () => {throw Error('must not notify')}}, log: () => {},
  })
  await controller.onRequest({action: 'create', threadId: 'thread-alice', kind: 'task', at: new Date(now + 1000).toISOString(), text: 'x'})
  now += 1000
  await controller.tick()
  assert.equal(controller.onRequest({action: 'list', threadId: 'thread-alice'}).items[0].status, 'accepted')
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0][0], 'alice')
  controller.close()
})
