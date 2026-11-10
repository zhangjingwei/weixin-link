/** Backend-specific readiness checks for a new conversation connection.
 * A failed check leaves the inbound message unsubmitted to the model.
 */
export function createAgentReadiness({backend, owners, codexAvailability}) {
  return async () => {
    if (backend.kind === 'host') {
      const ready = await codexAvailability({checkLogin:false})
      if (!ready.installed) return 'CODEX_NOT_INSTALLED'
    }
    return null
  }
}
