import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgentReadiness} from '../../src/base/agent-readiness.mjs'

test('agent readiness checks the selected backend without exposing provider errors', async () => {
  const owners = ['owner']
  let checked = 0
  const container = createAgentReadiness({backend: {kind: 'podman', preflight: async actual => {checked++; assert.equal(actual, owners); throw Error('private host detail')}}, owners, codexAvailability: async () => {throw Error('wrong provider')}})
  assert.equal(await container(), 'CONTAINER_NOT_READY')
  assert.equal(checked, 1)

  const codex = createAgentReadiness({backend: {kind: 'host', agentKind: 'codex'}, owners, codexAvailability: async () => ({installed: true, loggedIn: false})})
  assert.equal(await codex(), 'CODEX_NOT_LOGGED_IN')

  const claude = createAgentReadiness({backend: {kind: 'host', agentKind: 'claude'}, owners, codexAvailability: async () => {throw Error('wrong provider')}, env: {}})
  assert.equal(await claude(), 'CLAUDE_CREDENTIALS_REQUIRED')
  const configured = createAgentReadiness({backend: {kind: 'host', agentKind: 'claude'}, owners, codexAvailability: async () => {throw Error('wrong provider')}, env: {ANTHROPIC_API_KEY: 'test-key'}})
  assert.equal(await configured(), null)
})
