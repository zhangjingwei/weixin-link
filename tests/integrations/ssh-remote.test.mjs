import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {integrationStatus, invokeIntegration} from '../../src/integrations/runtime.mjs'
import {RemoteController} from '../../src/core/remote-tasks/remote-controller.mjs'

test('SSH plugin discovers existing host config but stays disabled and rejects calls without a session scope', async t => {
  const home = await mkdtemp(join(tmpdir(), 'integration-ssh-'))
  t.after(() => rm(home, {recursive: true, force: true}))
  const workspace = join(home, 'work'), stateDir = join(home, 'state')
  await mkdir(workspace); await mkdir(stateDir)
  await writeFile(join(workspace, 'remote-hosts.json'), JSON.stringify({version: 1, hosts: {example: {platform: 'posix', binary: '/opt/codex', root: '/work', transport: 'daemon-proxy'}}}))
  const options = {home, workspace, stateDir, account: 'default', scope: ''}
  assert.equal((await integrationStatus(options)).find(item => item.id === 'ssh-remote').enabled, false)
  await assert.rejects(invokeIntegration('ssh-remote', {action: 'list', host: 'example'}, options), /INTEGRATION_DISABLED/)
  await writeFile(join(stateDir, 'integrations.json'), JSON.stringify({version: 1, enabled: {'ssh-remote': true}}))
  assert.equal((await integrationStatus(options)).find(item => item.id === 'ssh-remote').valid, true)
  await assert.rejects(invokeIntegration('ssh-remote', {action: 'list', host: 'example'}, options), /INTEGRATION_ARGUMENTS_INVALID/)
  await assert.rejects(invokeIntegration('ssh-remote', {action: 'shell', command: 'id'}, {...options, scope: 'thread-1'}), /INTEGRATION_OPERATION_NOT_ALLOWED/)
  t.mock.method(RemoteController.prototype, 'run', async function (request) {return {root: this.root, scope: this.scope, action: request.action}})
  const result = await invokeIntegration('ssh-remote', {action: 'list', host: 'example'}, {...options, scope: 'thread-1'})
  assert.equal(result.root, workspace)
  assert.equal(result.scope, new RemoteController({root: workspace, scope: 'thread-1'}).scope)
  assert.equal(result.action, 'list')
})
