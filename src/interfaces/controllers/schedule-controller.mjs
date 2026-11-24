import {ScheduleService} from '../../application/schedules/schedule-service.mjs'
import {createScheduledTaskSubmission} from '../../application/schedules/schedule-actions.mjs'
import {createScheduleStateStore} from '../../infrastructure/storage/schedule-state.mjs'

/** Entry point for scheduled work.
 * The service owns persistence and retry state; this controller maps due
 * actions to the shared task queue or WeChat presenter.
 */
export async function createScheduleController({stateDir, owners, ready, track, conversations, enqueueTask, view, log, now}) {
  const service = await new ScheduleService({
    stateStore: createScheduleStateStore(stateDir), owners, ready, track, log, ...(now ? {now} : {}),
    send: (owner, text) => view.notice(owner, text),
    submitTask: createScheduledTaskSubmission({conversations, enqueueTask}),
  }).init()
  return {
    createForOwner: (...args)=>service.create(...args),
    listForOwner: (...args)=>service.list(...args),
    cancelForOwner: (...args)=>service.cancel(...args),
    start: () => service.start(),
    close: () => service.close(),
    tick: () => service.tick(),
  }
}
