import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgentReadiness} from '../../src/infrastructure/agents/agent-readiness.mjs'

test('agent readiness checks the selected backend without exposing provider errors', async () => {
  const owners = ['owner']
  let checked = 0
  const container = createAgentReadiness({backend: {kind: 'podman', preflight: async actual => {checked++; assert.equal(actual, owners); throw Error('private host detail')}}, owners, codexAvailability: async () => {throw Error('wrong provider')}})
  assert.equal(await container(), 'CONTAINER_NOT_READY')
  assert.equal(checked, 1)

  const codex = createAgentReadiness({backend: {kind: 'host', agentKind: 'codex'}, owners, codexAvailability: async () => ({installed: true, loggedIn: false})})
  assert.equal(await codex(), 'CODEX_NOT_LOGGED_IN')

})
