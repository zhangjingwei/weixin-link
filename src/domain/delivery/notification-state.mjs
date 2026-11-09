/** Unknown or accepted delivery is never replayed automatically. */
export function shouldPromptForUpdate(previous, tag) {
  return previous?.tag !== tag || previous.status === 'deferred'
}

/** A known, rejected text final may be offered one bounded resend. */
export function canRecoverFailedFinal(record, session) {
  const recovery = record?.recovery
  return recovery?.execution === 'completed' && recovery.delivery === 'failed' && recovery.delivery_error?.api_code === -2 &&
    !recovery.autoResend && !!record.lastReply && !record.lastOutput &&
    !(session && (session.busy || session.finishing || session.connecting))
}
