/** Unknown or accepted delivery is never replayed automatically. */
export function shouldPromptForUpdate(previous, tag) {
  return previous?.tag !== tag || previous.status === 'deferred'
}

/** A known, rejected text final may be offered one bounded resend. */
export function canRecoverFailedFinal(record, session, confirmedRejection = false) {
  const recovery = record?.recovery
  return recovery?.execution === 'completed' && recovery.delivery === 'failed' && confirmedRejection &&
    !recovery.autoResend && !!record.lastReply && !record.lastOutput &&
    !(session && (session.busy || session.finishing || session.connecting))
}
