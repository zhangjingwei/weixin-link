export function scheduleCommand(request, {manager, conversations, service}) {
  if (!service) throw Error('SCHEDULE_STATE_UNAVAILABLE')
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.threadId !== 'string') throw Error('SCHEDULE_ARGUMENTS_INVALID')
  const session = [...manager.sessions.values()].find(item => item.threadId === request.threadId && !item.exited)
  if (!session) throw Error('SCHEDULE_SESSION_NOT_FOUND')
  const owner = conversations.recipient(session.userId)
  if (!conversations.realOwners.has(owner)) throw Error('SCHEDULE_OWNER_DENIED')
  const fields = {create: ['action', 'threadId', 'kind', 'at', 'repeat', 'text'], list: ['action', 'threadId', 'offset', 'limit'], cancel: ['action', 'threadId', 'id']}[request.action]
  if (!fields || Object.keys(request).some(key => !fields.includes(key))) throw Error('SCHEDULE_ARGUMENTS_INVALID')
  if (request.action === 'create') return service.create(owner, {kind: request.kind, at: request.at, repeat: request.repeat, text: request.text}, session.userId)
  if (request.action === 'list') return service.list(owner, {offset: request.offset, limit: request.limit})
  if (request.action === 'cancel') return service.cancel(owner, request.id)
}
