import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {integrationStatus, invokeIntegration} from '../../src/integrations/runtime.mjs'
import {RemoteController} from '../../src/application/remote-tasks/remote-controller.mjs'
import sshRemote from '../../src/integrations/ssh-remote/index.mjs'

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

test('a legacy ledger beside a custom host config is not silently replaced',async t=>{
 const home=await mkdtemp(join(tmpdir(),'integration-ssh-ledger-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const workspace=join(home,'workspace'),legacy=join(home,'old')
 await mkdir(workspace);await mkdir(legacy)
 const configPath=join(legacy,'remote-hosts.json'),host={platform:'posix',binary:'/opt/codex',root:'/work',transport:'daemon-proxy'}
 await writeFile(configPath,JSON.stringify({version:1,hosts:{example:host}}))
 await writeFile(join(legacy,'remote-sessions.json'),JSON.stringify({task:{kind:'official-remote-task'}}))
 await assert.rejects(sshRemote.invoke({version:1,hosts:{example:host}},{action:'list',host:'example'},{home,workspace,scope:'thread-1',env:{WECHAT_REMOTE_HOSTS:configPath}}),/REMOTE_STATE_LOCATION_MISMATCH/)
 const stateDir=join(home,'state');await mkdir(stateDir)
 await writeFile(join(stateDir,'integrations.json'),JSON.stringify({version:1,enabled:{'ssh-remote':true}}))
 await assert.rejects(invokeIntegration('ssh-remote',{action:'list',host:'example'},{home,workspace,stateDir,account:'default',scope:'thread-1',env:{WECHAT_REMOTE_HOSTS:configPath}}),/REMOTE_STATE_LOCATION_MISMATCH/)
})

test('separate workspaces select independent ledger roots for the same session scope',async t=>{
 const home=await mkdtemp(join(tmpdir(),'integration-ssh-accounts-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const host={platform:'posix',binary:'/opt/codex',root:'/work',transport:'daemon-proxy'}
 const config={version:1,hosts:{example:host}},first=join(home,'first'),second=join(home,'second')
 for(const workspace of [first,second]){await mkdir(workspace);await writeFile(join(workspace,'remote-hosts.json'),JSON.stringify(config))}
 t.mock.method(RemoteController.prototype,'run',async function(){return {root:this.root,scope:this.scope,ledger:this.store.path}})
 const a=await sshRemote.invoke(config,{action:'list',host:'example'},{home,workspace:first,scope:'same-thread',env:{}})
 const b=await sshRemote.invoke(config,{action:'list',host:'example'},{home,workspace:second,scope:'same-thread',env:{}})
 assert.notEqual(a.ledger,b.ledger)
 assert.equal(a.ledger,join(first,'remote-sessions.json'))
 assert.equal(b.ledger,join(second,'remote-sessions.json'))
 assert.equal(a.scope,b.scope)
})
