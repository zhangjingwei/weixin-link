/** A conversation with live or uncertain work cannot be archived or deleted. */
export function conversationHasUnfinishedWork({session, recovery, pending = false, uncertain = false}) {
  return Boolean(
    session && (session.busy || session.finishing || session.connecting || session.selecting || session.exiting || session.queue?.length || session.state === 'stopping') ||
    ['unknown', 'running', 'submitted'].includes(recovery?.execution) ||
    (typeof pending === 'function' ? pending() : pending) ||
    (typeof uncertain === 'function' ? uncertain() : uncertain)
  )
}

/** A scheduled model task must remain in its original, usable conversation. */
export function canSubmitScheduledTask({owner, entry}) {
  return !!entry && entry.owner === owner && !entry.deleted && !entry.archived
}
