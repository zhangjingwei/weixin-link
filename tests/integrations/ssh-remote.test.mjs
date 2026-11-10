import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {integrationStatus,invokeIntegration} from '../../src/integrations/runtime.mjs'
import sshRemote from '../../src/integrations/ssh-remote/index.mjs'
import {SshOperations} from '../../src/application/remote-tasks/ssh-operations.mjs'

test('SSH integration uses host configuration and requires current session scope',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ssh-integration-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const workspace=join(home,'work'),stateDir=join(home,'state')
 await mkdir(workspace);await mkdir(stateDir)
 const config={version:1,hosts:{example:{platform:'posix',root:'/work'}}}
 await writeFile(join(workspace,'remote-hosts.json'),JSON.stringify(config))
 const options={home,workspace,stateDir,account:'default',scope:''}
 assert.equal((await integrationStatus(options)).find(item=>item.id==='ssh-remote').enabled,false)
 await assert.rejects(invokeIntegration('ssh-remote',{action:'list'},options),/INTEGRATION_DISABLED/)
 await writeFile(join(stateDir,'integrations.json'),JSON.stringify({version:1,enabled:{'ssh-remote':true}}))
 assert.equal((await integrationStatus(options)).find(item=>item.id==='ssh-remote').valid,true)
 await assert.rejects(invokeIntegration('ssh-remote',{action:'list'},options),/INTEGRATION_ARGUMENTS_INVALID/)
 t.mock.method(SshOperations.prototype,'runRequest',async request=>({action:request.action}))
 assert.deepEqual(await invokeIntegration('ssh-remote',{action:'list'},{...options,scope:'thread-1'}),{action:'list'})
 assert.deepEqual(await sshRemote.invoke(config,{action:'list'},{scope:'thread-1'}),{action:'list'})
 t.mock.method(SshOperations.prototype,'runRequest',async()=>{throw Error('REMOTE_RESULT_UNCERTAIN')})
 await assert.rejects(invokeIntegration('ssh-remote',{action:'exec'},{...options,scope:'thread-1'}),/REMOTE_RESULT_UNCERTAIN/)
})
