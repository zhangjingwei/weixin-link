import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {ScheduleService} from '../../src/application/schedules/schedule-service.mjs'
import {createScheduleStateStore} from '../../src/infrastructure/storage/schedule-state.mjs'
import {nextOccurrence} from '../../src/domain/schedules/recurrence.mjs'
import {scheduleCommand} from '../../src/interfaces/controllers/schedule-controller.mjs'
import {runScheduleCommand} from '../../src/interfaces/cli/schedule-cli.mjs'
import {RuntimeControl, controlRequest} from '../../src/infrastructure/runtime/runtime-control.mjs'
import {accountPaths} from '../../src/wechat/accounts.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'

async function fixture(t, send = async () => ({status: 'accepted'})) {
  const stateDir = await mkdtemp(join(tmpdir(), 'reminders-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  let now = Date.parse('2026-11-06T12:00:00Z')
  const service = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice', 'bob'], send, now: () => now}).init()
  return {service, stateDir, advance: ms => {now += ms}, at: ms => new Date(now + ms).toISOString()}
}

test('reminders persist, isolate owners and cancel only the owning user', async t => {
  const {service, stateDir, at, advance} = await fixture(t)
  const first = await service.create('alice', {at: at(60000), text: ' 开会 '})
  assert.equal(first.text, '开会')
  assert.deepEqual(service.list('bob').items, [])
  await assert.rejects(service.cancel('bob', first.id), /SCHEDULE_NOT_FOUND/)
  assert.equal(service.list('alice').items[0].id, first.id)
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice', 'bob'], send: async () => ({status: 'accepted'}), now: () => Date.parse('2026-11-06T12:00:00Z')}).init()
  assert.equal(restarted.list('alice').items[0].id, first.id)
  await restarted.cancel('alice', first.id)
  advance(60000)
  await restarted.tick()
  assert.equal(restarted.list('alice').items[0].status, 'cancelled')
})

test('due reminder is recorded before delivery and never repeated after accepted or uncertain result', async t => {
  const calls = []
  const {service, stateDir, at, advance} = await fixture(t, async (owner, text) => {calls.push({owner, text}); return {status: 'accepted'}})
  const accepted = await service.create('alice', {at: at(1000), text: '喝水'})
  advance(1000)
  await service.tick()
  assert.deepEqual(calls, [{owner: 'alice', text: '⏰ 提醒：喝水'}])
  assert.equal(service.list('alice').items[0].status, 'accepted')
  await service.tick()
  assert.equal(calls.length, 1)
  const later = await service.create('alice', {at: at(1000), text: '休息'})
  const raw = JSON.parse(await readFile(join(stateDir, 'schedules.json'), 'utf8'))
  raw.jobs[later.id].status = 'sending'
  await writeFile(join(stateDir, 'schedules.json'), JSON.stringify(raw))
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice', 'bob'], send: async () => {throw Error('must not resend')}, now: () => Date.parse(later.at) + 1000}).init()
  assert.equal(restarted.list('alice').items.find(item => item.id === later.id).status, 'unknown')
  await restarted.tick()
  assert.equal(restarted.list('alice').items.find(item => item.id === accepted.id).status, 'accepted')
})

test('invalid time, unknown owner and malformed requests cannot create a reminder', async t => {
  const {service, at} = await fixture(t)
  await assert.rejects(service.create('other', {at: at(1000), text: 'x'}), /SCHEDULE_OWNER_DENIED/)
  await assert.rejects(service.create('alice', {at: at(-1000), text: 'x'}), /SCHEDULE_TIME_INVALID/)
  await assert.rejects(service.create('alice', {at: at(1000), text: 'x', owner: 'bob'}), /SCHEDULE_ARGUMENTS_INVALID/)
  await assert.rejects(service.create('alice', {at: 'tomorrow', text: 'x'}), /SCHEDULE_ARGUMENTS_INVALID/)
  assert.equal(service.list('alice').items.length, 0)
})

test('daily and weekly reminders advance after one accepted delivery', async t => {
  const calls = []
  const {service, advance} = await fixture(t, async (owner, text) => {calls.push([owner, text]); return {status: 'accepted'}})
  const daily = await service.create('alice', {repeat: {frequency: 'daily', time: '20:01', timeZone: 'Asia/Shanghai'}, text: '喝水'})
  const weekly = await service.create('bob', {repeat: {frequency: 'weekly', time: '20:01', timeZone: 'Asia/Shanghai', weekdays: [5]}, text: '周会'})
  assert.equal(daily.at, '2026-11-06T12:01:00.000Z')
  assert.equal(weekly.at, daily.at)
  advance(60000)
  await service.tick(); await service.tick()
  assert.equal(calls.length, 2)
  assert.equal(service.list('alice').items[0].at, '2026-11-07T12:01:00.000Z')
  assert.equal(service.list('bob').items[0].at, '2026-11-13T12:01:00.000Z')
  assert.equal(service.list('alice').items[0].lastTrigger.status, 'accepted')
})

test('recurrence skips spring gap and sends only once in repeated fall hour', () => {
  const spring = {frequency: 'daily', time: '02:30', timeZone: 'America/Los_Angeles'}
  assert.equal(nextOccurrence(spring, Date.parse('2026-03-08T08:00:00Z')), '2026-03-09T09:30:00.000Z')
  const fall = {frequency: 'daily', time: '01:30', timeZone: 'America/Los_Angeles'}
  assert.equal(nextOccurrence(fall, Date.parse('2026-11-01T07:00:00Z')), '2026-11-01T08:30:00.000Z')
  assert.equal(nextOccurrence(fall, Date.parse('2026-11-01T08:30:00Z'), {skipLocalDate: '2026-11-1'}), '2026-11-02T09:30:00.000Z')
})

test('uncertain recurring delivery pauses future occurrences across restart', async t => {
  const {service, stateDir, advance} = await fixture(t, async () => {throw Error('timeout after submit')})
  const job = await service.create('alice', {repeat: {frequency: 'daily', time: '20:01', timeZone: 'Asia/Shanghai'}, text: '喝水'})
  advance(60000)
  await service.tick()
  assert.equal(service.list('alice').items[0].status, 'unknown')
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice', 'bob'], send: async () => {throw Error('must not resend')}, now: () => Date.parse(job.at) + 86_400_000}).init()
  await restarted.tick()
  assert.equal(restarted.list('alice').items[0].status, 'unknown')
  assert.equal(restarted.list('alice').items[0].at, job.at)
})

test('reminders for a removed owner remain stored but are not delivered', async t => {
  const {service, stateDir, at} = await fixture(t)
  await service.create('bob', {at: at(1000), text: 'private'})
  const calls = []
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async owner => {calls.push(owner); return {status: 'accepted'}}, now: () => Date.parse('2026-11-06T12:00:02Z')}).init()
  await restarted.tick()
  assert.deepEqual(calls, [])
  assert.deepEqual(restarted.list('alice').items, [])
})

test('Codex command reaches only the current account control endpoint and requires a thread', async t => {
  const home = await mkdtemp('/tmp/rctl-')
  t.after(() => rm(home, {recursive: true, force: true}))
  const account = accountPaths('default', home)
  await mkdir(account.stateDir, {recursive: true})
  const calls = [], runtime = new RuntimeControl({onSchedule: async request => {calls.push(request); return {ok: true}}})
  try {
    await runtime.listen(account.socket)
    await assert.rejects(runScheduleCommand(Readable.from(['{"action":"list"}']), {home, threadId: ''}), /SCHEDULE_SESSION_REQUIRED/)
    assert.deepEqual(await runScheduleCommand(Readable.from(['{"action":"list"}']), {home, threadId: 'thread-123'}), {ok: true})
    assert.deepEqual(calls, [{action: 'list', threadId: 'thread-123'}])
  } finally {await runtime.close()}
})

test('schedule command is counted as active during maintenance drain', async t => {
  const dir = await mkdtemp('/tmp/sctl-')
  t.after(() => rm(dir, {recursive: true, force: true}))
  const socket = join(dir, 'runtime.sock')
  let release
  const runtime = new RuntimeControl({onSchedule: () => new Promise(resolve => {release = () => resolve({ok: true})})})
  try {
    await runtime.listen(socket)
    const request = controlRequest(socket, 'POST', '/schedules', {action: 'list', threadId: 'thread-123'})
    for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.ok(release)
    runtime.command('drain', 'schedule-lease')
    assert.equal(runtime.status().idle, false)
    assert.throws(() => runtime.command('seal', 'schedule-lease'), error => error.statusCode === 409)
    release()
    assert.deepEqual(await request, {ok: true})
    runtime.command('resume', 'schedule-lease')
  } finally {await runtime.close()}
})

test('reminder command resolves the real owner from an active session', async t => {
  const {service, at} = await fixture(t)
  const manager = {sessions: new Map([['alice#conversation#one', {threadId: 'thread-alice', userId: 'alice#conversation#one'}]])}
  const conversations = {recipient: key => key.split('#')[0], realOwners: new Set(['alice'])}
  const context = {manager, conversations, service}
  assert.throws(() => scheduleCommand({action: 'create', threadId: 'thread-bob', at: at(1000), text: 'x'}, context), /SCHEDULE_SESSION_NOT_FOUND/)
  assert.throws(() => scheduleCommand({action: 'create', threadId: 'thread-alice', owner: 'bob', at: at(1000), text: 'x'}, context), /SCHEDULE_ARGUMENTS_INVALID/)
  const item = await scheduleCommand({action: 'create', threadId: 'thread-alice', at: at(1000), text: 'x'}, context)
  assert.equal(service.list('alice').items[0].id, item.id)
  assert.equal(service.list('bob').items.length, 0)
  assert.equal(scheduleCommand({action: 'list', threadId: 'thread-alice'}, context).items.length, 1)
})

test('scheduled task enters the durable queue once with the original conversation', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'scheduled-task-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  const jobs = new DurableJobs(join(stateDir, 'inbox.sqlite'))
  t.after(() => jobs.close())
  let now = Date.parse('2026-11-06T12:00:00Z')
  const submitTask = (owner, key, text, id, at) => ({status: 'accepted', submissionId: jobs.add(key, {text}, 'schedule:' + id + ':' + at)})
  const service = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async () => {throw Error('wrong route')}, submitTask, now: () => now}).init()
  const scheduled = await service.create('alice', {kind: 'task', at: '2026-11-06T12:01:00Z', text: '汇总新闻'}, 'alice#conversation#one')
  now += 60000
  await service.tick(); await service.tick()
  assert.equal(jobs.pending().length, 1)
  assert.equal(jobs.pending()[0].owner, 'alice#conversation#one')
  assert.equal(jobs.pending()[0].input.text, '汇总新闻')
  assert.equal(service.list('alice').items[0].submissionId, jobs.pending()[0].id)
  assert.equal(service.list('alice').items[0].status, 'accepted')
  assert.equal(scheduled.kind, 'task')
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async () => {throw Error('wrong route')}, submitTask: () => {throw Error('must not submit twice')}, now: () => now}).init()
  await restarted.tick()
  assert.equal(jobs.pending().length, 1)
})

test('unknown scheduled task submission is not replayed after restart', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'scheduled-uncertain-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  const jobs = new DurableJobs(join(stateDir, 'inbox.sqlite'))
  t.after(() => jobs.close())
  let now = Date.parse('2026-11-06T12:00:00Z')
  const service = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async () => {}, now: () => now, submitTask: (_owner, key, text, id, at) => {
    jobs.add(key, {text}, 'schedule:' + id + ':' + at)
    throw Error('result lost after enqueue')
  }}).init()
  await service.create('alice', {kind: 'task', at: '2026-11-06T12:01:00Z', text: '整理报告'}, 'alice#conversation#one')
  now += 60000
  await service.tick()
  assert.equal(service.list('alice').items[0].status, 'unknown')
  const restarted = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async () => {}, submitTask: () => {throw Error('must not submit twice')}, now: () => now + 60000}).init()
  await restarted.tick()
  assert.equal(jobs.pending().length, 1)
})

test('repeating task advances after queue acceptance and unavailable target pauses it', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'scheduled-repeat-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  let now = Date.parse('2026-11-06T12:00:00Z'), allowed = true, calls = 0
  const service = await new ScheduleService({stateStore: createScheduleStateStore(stateDir), owners: ['alice'], send: async () => {throw Error('wrong route')}, now: () => now, submitTask: () => {
    calls++
    if (!allowed) throw Object.assign(Error('SCHEDULE_TASK_UNAVAILABLE'), {deliveryState: 'failed'})
    return {status: 'accepted', submissionId: 'queue-' + calls}
  }}).init()
  await service.create('alice', {kind: 'task', repeat: {frequency: 'daily', time: '20:01', timeZone: 'Asia/Shanghai'}, text: '整理新闻'}, 'alice#conversation#one')
  now += 60000
  await service.tick()
  assert.equal(service.list('alice').items[0].at, '2026-11-07T12:01:00.000Z')
  assert.equal(service.list('alice').items[0].lastTrigger.submissionId, 'queue-1')
  allowed = false; now += 86_400_000
  await service.tick(); await service.tick()
  assert.equal(service.list('alice').items[0].status, 'failed')
  assert.equal(calls, 2)
})

test('schedule instructions are available to local agents, independent of model kind', async t => {
  const {stateDir} = await fixture(t)
  const guidance = 'SCHEDULE_TOOL_MARKER'
  const make = (backend, agentKind = 'codex') => new SessionManager({stateDir, cwd: stateDir, owners: [], backend, agentKind, scheduleGuidance: guidance})
  assert.match(await make({kind: 'host'}).sessionInstructions(), /SCHEDULE_TOOL_MARKER/)
  assert.doesNotMatch(await make({kind: 'podman'}).sessionInstructions(), /SCHEDULE_TOOL_MARKER/)
  assert.match(await make({kind: 'host'}, 'claude').sessionInstructions(), /SCHEDULE_TOOL_MARKER/)
})
