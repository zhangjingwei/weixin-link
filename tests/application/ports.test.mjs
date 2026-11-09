import test from 'node:test'
import assert from 'node:assert/strict'
import {ScheduleService} from '../../src/application/schedules/schedule-service.mjs'
import {UpdateNotifier} from '../../src/application/notifications/update-notifier.mjs'

test('schedule use case commits sending before calling delivery through injected ports', async () => {
  const events = []
  let saved = null
  const stateStore = {
    load: async () => saved,
    save: async value => {saved = structuredClone(value); events.push('save:' + Object.values(saved.jobs)[0].status)},
  }
  let now = Date.parse('2026-11-06T12:00:00Z')
  const service = await new ScheduleService({stateStore, owners: ['alice'], now: () => now,
    send: async () => {events.push('send'); return {status: 'accepted'}}}).init()
  await service.create('alice', {at: new Date(now + 1000).toISOString(), text: '喝水'})
  now += 1000
  await service.tick()
  assert.deepEqual(events, ['save:pending', 'save:sending', 'send', 'save:accepted'])
})

test('update use case uses injected release and state ports and does not replay unknown delivery', async () => {
  const records = new Map(), events = []
  const stateStore = {path: owner => owner, read: async owner => records.get(owner) ?? null,
    write: async (owner, value) => {records.set(owner, value); events.push('write:' + value.status)}}
  const options = {stateStore, owners: ['alice'], readInstalled: async () => ({version: 1, repository: 'zhangjingwei/weixin-link', ref: 'v1.0.0', commit: 'a'.repeat(7)}),
    fetchLatest: async () => ({tag: 'v1.1.0', commit: 'b'.repeat(40)}),
    send: async () => {events.push('send'); throw Error('timeout')}}
  await new UpdateNotifier(options).tick()
  await new UpdateNotifier(options).tick()
  assert.deepEqual(events, ['write:sending', 'send', 'write:unknown'])
})
