export function executionState(status, waiting = false) {
  return status === 'completed' && waiting ? 'waiting_attachment' : ['completed', 'failed', 'interrupted'].includes(status) ? status : 'unknown'
}
