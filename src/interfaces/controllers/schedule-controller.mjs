import {ScheduleService} from '../../application/schedules/schedule-service.mjs'
import {createScheduledTaskSubmission, scheduleCommand} from '../../application/schedules/schedule-actions.mjs'

export {scheduleCommand} from '../../application/schedules/schedule-actions.mjs'

/** Entry point for scheduled work and requests from the local schedule API.
 * The service owns persistence and retry state; this controller maps due
 * actions to the shared task queue or WeChat presenter.
 */
export async function createScheduleController({stateDir, owners, ready, track, manager, conversations, enqueueTask, agent, backend, view, log, now}) {
  const service = await new ScheduleService({
    stateDir, owners, ready, track, log, ...(now ? {now} : {}),
    send: (owner, text) => view.notice(owner, text),
    submitTask: createScheduledTaskSubmission({conversations, enqueueTask, agent, backend}),
  }).init()
  return {
    onRequest: request => scheduleCommand(request, {manager, conversations, service}),
    start: () => service.start(),
    close: () => service.close(),
    tick: () => service.tick(),
  }
}
