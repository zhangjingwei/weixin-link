import {randomUUID} from 'node:crypto'
import {mkdir, open, readFile, rename, unlink, lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {deliveryFailureState} from '../delivery/delivery-error.mjs'
import {validateRepeat, nextOccurrence, localDateAt} from './recurrence.mjs'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_TEXT = 1000
const MAX_JOBS = 500
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000
const MAX_TIMER_MS = 30_000
const code = value => Object.assign(Error(value), {code: value})
function validJob(id, job) {
  if (id !== job?.id || typeof job.owner !== 'string' || !job.owner || !['reminder', 'task'].includes(job.kind ?? 'reminder') || job.kind === 'task' && (typeof job.conversationKey !== 'string' || !job.conversationKey) || !['pending', 'sending', 'accepted', 'failed', 'unknown', 'cancelled'].includes(job.status) || typeof job.at !== 'string' || !Number.isFinite(Date.parse(job.at)) || typeof job.text !== 'string' || !job.text || job.text.length > MAX_TEXT) return false
  if (job.repeat !== undefined) try {validateRepeat(job.repeat)} catch {return false}
  return true
}

export class ScheduleService {
  constructor({stateDir, owners, send, submitTask = async () => {throw Object.assign(code('SCHEDULE_TASK_UNAVAILABLE'), {deliveryState: 'failed'})}, ready = () => true, track = work => work(), now = Date.now, log = () => {}}) {
    Object.assign(this, {stateDir, owners: new Set(owners), send, submitTask, ready, track, now, log})
    this.path = join(stateDir, 'schedules.json')
    this.state = {version: 1, jobs: {}}
    this.queue = Promise.resolve()
    this.closed = false
    this.timer = null
  }
  serialize(work) {
    const task = this.queue.catch(() => {}).then(work)
    this.queue = task
    return task
  }
  async init() {
    await mkdir(this.stateDir, {recursive: true, mode: 0o700})
    try {
      const info = await lstat(this.path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) throw code('SCHEDULE_STATE_INVALID')
      const value = JSON.parse(await readFile(this.path, 'utf8'))
      if (value.version !== 1 || !value.jobs || typeof value.jobs !== 'object' || Array.isArray(value.jobs) || Object.keys(value.jobs).length > MAX_JOBS || Object.entries(value.jobs).some(([id, job]) => !validJob(id, job))) throw code('SCHEDULE_STATE_INVALID')
      this.state = value
    } catch (error) {
      if (error.code !== 'ENOENT') throw code('SCHEDULE_STATE_INVALID')
    }
    let recovered = false
    for (const job of Object.values(this.state.jobs)) if (job.status === 'sending') {job.status = 'unknown'; recovered = true}
    if (recovered) await this.save()
    return this
  }
  async save() {
    const text = JSON.stringify(this.state) + '\n'
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw code('SCHEDULE_LIMIT')
    const temp = this.path + '.' + randomUUID() + '.tmp'
    let file
    try {
      file = await open(temp, 'wx', 0o600)
      await file.writeFile(text)
      await file.sync()
      await file.close(); file = null
      await rename(temp, this.path)
    } finally {
      await file?.close()
      await unlink(temp).catch(error => {if (error.code !== 'ENOENT') throw error})
    }
  }
  checkOwner(owner) {if (!this.owners.has(owner)) throw code('SCHEDULE_OWNER_DENIED')}
  async create(owner, request, conversationKey) {
    this.checkOwner(owner)
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['at', 'text', 'repeat', 'kind'].includes(key)) || !['reminder', 'task'].includes(request.kind ?? 'reminder') || request.kind === 'task' && (typeof conversationKey !== 'string' || !conversationKey) || typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_TEXT || (request.at === undefined) === (request.repeat === undefined)) throw code('SCHEDULE_ARGUMENTS_INVALID')
    let repeat, at, now = this.now()
    if (request.repeat !== undefined) {
      repeat = validateRepeat(request.repeat)
      at = Date.parse(nextOccurrence(repeat, now))
    } else {
      if (typeof request.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(request.at)) throw code('SCHEDULE_ARGUMENTS_INVALID')
      at = Date.parse(request.at)
      if (!Number.isFinite(at) || at <= now || at - now > MAX_FUTURE_MS) throw code('SCHEDULE_TIME_INVALID')
    }
    return this.serialize(async () => {
      if (this.closed) throw code('SCHEDULE_CLOSED')
      const old = this.state.jobs
      const retained = Object.fromEntries(Object.entries(old).filter(([, job]) => !(['accepted', 'cancelled'].includes(job.status) && Date.parse(job.triggeredAt ?? job.at) < this.now() - 30 * 24 * 60 * 60 * 1000)))
      if (Object.keys(retained).length >= MAX_JOBS) throw code('SCHEDULE_LIMIT')
      this.state.jobs = retained
      const job = {id: randomUUID(), owner, kind: request.kind ?? 'reminder', ...(request.kind === 'task' ? {conversationKey} : {}), at: new Date(at).toISOString(), text: request.text.trim(), ...(repeat ? {repeat} : {}), status: 'pending', createdAt: new Date(now).toISOString()}
      this.state.jobs[job.id] = job
      try {await this.save()} catch (error) {this.state.jobs = old; throw error}
      return this.public(job)
    })
  }
  public(job) {return {id: job.id, kind: job.kind ?? 'reminder', at: job.at, text: job.text, status: job.status, ...(job.repeat ? {repeat: job.repeat} : {}), ...(job.triggeredAt ? {triggeredAt: job.triggeredAt} : {}), ...(job.submissionId ? {submissionId: job.submissionId} : {}), ...(job.lastTrigger ? {lastTrigger: job.lastTrigger} : {})}}
  list(owner, {offset = 0, limit = 10} = {}) {
    this.checkOwner(owner)
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_JOBS || !Number.isInteger(limit) || limit < 1 || limit > 10) throw code('SCHEDULE_ARGUMENTS_INVALID')
    const jobs = Object.values(this.state.jobs).filter(job => job.owner === owner).sort((a, b) => a.at.localeCompare(b.at))
    return {items: jobs.slice(offset, offset + limit).map(job => this.public(job)), nextOffset: offset + limit < jobs.length ? offset + limit : null}
  }
  async cancel(owner, id) {
    this.checkOwner(owner)
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw code('SCHEDULE_ARGUMENTS_INVALID')
    return this.serialize(async () => {
      const job = this.state.jobs[id]
      if (!job || job.owner !== owner) throw code('SCHEDULE_NOT_FOUND')
      if (job.status === 'sending') throw code('SCHEDULE_DELIVERY_IN_PROGRESS')
      if (job.status === 'pending') {
        job.status = 'cancelled'
        try {await this.save()} catch (error) {job.status = 'pending'; throw error}
      }
      return this.public(job)
    })
  }
  async tick() {
    if (this.ticking) return this.ticking
    this.ticking = this.drainDue()
    try {return await this.ticking} finally {this.ticking = null}
  }
  async drainDue() {
    for (let count = 0; count < 10; count++) {
      if (this.closed || !this.ready()) return
      const job = await this.serialize(async () => {
        if (this.closed || !this.ready()) return null
        const due = Object.values(this.state.jobs).filter(item => this.owners.has(item.owner) && item.status === 'pending' && Date.parse(item.at) <= this.now()).sort((a, b) => a.at.localeCompare(b.at))[0]
        if (!due) return null
        due.status = 'sending'
        try {await this.save()} catch (error) {due.status = 'pending'; throw error}
        return due
      })
      if (!job) return
      let status = 'accepted', result
      try {
        result = job.kind === 'task'
          ? await this.submitTask(job.owner, job.conversationKey, job.text, job.id, job.at)
          : await this.send(job.owner, `⏰ 提醒：${job.text}`)
        if (result?.status !== 'accepted') status = result?.status === 'failed' ? 'failed' : 'unknown'
      } catch (error) {status = deliveryFailureState(error); this.log('schedule.delivery_failed', {status})}
      await this.serialize(async () => {
        const triggeredAt = new Date(this.now()).toISOString()
        if (job.repeat && status === 'accepted') {
          const deliveredAt = job.at
          job.lastTrigger = {at: deliveredAt, status, triggeredAt, ...(result?.submissionId ? {submissionId: result.submissionId} : {})}
          job.at = nextOccurrence(job.repeat, this.now(), {skipLocalDate: localDateAt(job.repeat.timeZone, Date.parse(deliveredAt))})
          job.status = 'pending'
        } else job.status = status
        job.triggeredAt = triggeredAt
        if (result?.submissionId) job.submissionId = result.submissionId
        try {await this.save()} catch (error) {job.status = 'unknown'; throw error}
      })
    }
  }
  start() {
    if (this.timer || this.closed) return
    this.timer = setInterval(() => {void this.track(() => this.tick()).catch(() => this.log('schedule.tick_failed', {status: 'failed'}))}, MAX_TIMER_MS)
    this.timer.unref()
    void this.track(() => this.tick()).catch(() => this.log('schedule.tick_failed', {status: 'failed'}))
  }
  close() {this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = null}
}
