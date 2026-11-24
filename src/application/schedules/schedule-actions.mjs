import {canSubmitScheduledTask} from '../../domain/conversations/eligibility.mjs'

/** Route a due task to the existing owner-scoped durable queue. */
export function createScheduledTaskSubmission({conversations, enqueueTask}) {
  return (owner, key, text, id, at) => {
    const entry = conversations.entry(key)
    if (!canSubmitScheduledTask({owner, entry})) {
      throw Object.assign(Error('SCHEDULE_TASK_UNAVAILABLE'), {deliveryState: 'failed'})
    }
    const submissionId = enqueueTask(key, {text}, 'schedule:' + id + ':' + at)
    return {status: 'accepted', submissionId}
  }
}
