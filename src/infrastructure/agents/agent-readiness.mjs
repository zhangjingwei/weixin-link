/** Backend-specific readiness checks for a new conversation connection.
 * A failed check leaves the inbound message unsubmitted to the model.
 */
export function createAgentReadiness({backend, owners, codexAvailability}) {
  return async () => {
    if (backend.kind === 'podman') {
      try { await backend.preflight(owners) } catch { return 'CONTAINER_NOT_READY' }
      return null
    }
    if (backend.kind === 'host') {
      const ready = await codexAvailability()
      if (!ready.installed) return 'CODEX_NOT_INSTALLED'
      if (!ready.loggedIn) return 'CODEX_NOT_LOGGED_IN'
    }
    return null
  }
}
