import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {upgradeInstallation,standardDeployment} from '../../src/setup/upgrade.mjs'

test('upgrade CLI runs when invoked through a symlinked path',async t=>{
 if(process.platform==='win32')return t.skip('file symlinks may require privileges on Windows')
 const directory=await mkdtemp(join(tmpdir(),'weixin-upgrade-cli-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const entry=join(directory,'upgrade.mjs')
 await symlink(fileURLToPath(new URL('../../src/setup/upgrade.mjs',import.meta.url)),entry)
 await assert.rejects(promisify(execFile)(process.execPath,[entry]),error=>{
  assert.equal(error.code,1)
  assert.match(error.stderr,/用法：node src\/setup\/upgrade.mjs/)
  return true
 })
})

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'weixin-upgrade-test-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const source=join(home,'new release'),target=join(home,'installed source'),state=join(home,'.local/share/wechat-ping-bot'),calls=[]
 for(const path of [source,target,state])await mkdir(path,{recursive:true})
 for(const path of [source,target])await writeFile(join(path,'package.json'),' {"name":"weixin-link"}')
 await writeFile(join(source,'version'),'new');await writeFile(join(target,'version'),'old')
 await writeFile(join(state,'credentials.json'),'original-credentials',{mode:0o600})
 await mkdir(join(state,'tools'));await writeFile(join(state,'tools/node'),'runtime')
 const account={id:'default',active:true},adapter={services:[account],status:async()=>({ready:true}),
  control:async(a,action)=>{calls.push(action);return {idle:true}},stop:async()=>calls.push('stop'),start:async()=>calls.push('start')}
 const options={home,source,target,adapter,prepare:async()=>calls.push('prepare'),log:()=>{},healthAttempts:1,wait:async()=>{}}
 return {home,source,target,state,calls,adapter,options}
}
test('upgrade stages first, retains old code and private state, and restarts only active services',async t=>{
 const f=await fixture(t)
 f.adapter.services.push({id:'other',active:false})
 const result=await upgradeInstallation(f.options)
 assert.equal(result.status,'complete')
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 assert.equal(await readFile(join(result.backup,'version'),'utf8'),'old')
 assert.equal(await readFile(join(result.recovery,'state/credentials.json'),'utf8'),'original-credentials')
 assert.equal(await readFile(join(f.state,'credentials.json'),'utf8'),'original-credentials')
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','stop','start'])
 assert(!(await readdir(join(result.recovery,'state'))).includes('tools'))
})
test('failed health check restores old source and database contents before restarting',async t=>{
 const f=await fixture(t)
 f.adapter.status=async()=>{
  const version=await readFile(join(f.target,'version'),'utf8')
  if(version==='new'){
   await writeFile(join(f.state,'credentials.json'),'changed')
   await writeFile(join(f.state,'new-schema.db'),'new schema')
  }
  return {ready:version==='old'}
 }
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_HEALTH_CHECK_FAILED/)
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
 assert.equal(await readFile(join(f.state,'credentials.json'),'utf8'),'original-credentials')
 assert(!(await readdir(f.state)).includes('new-schema.db'))
 assert.equal(await readFile(join(f.state,'tools/node'),'utf8'),'runtime')
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','start','stop','start'])
})
test('dependency failure leaves live service and installed files unchanged',async t=>{
 const f=await fixture(t)
 await assert.rejects(upgradeInstallation({...f.options,prepare:async()=>{throw Error('DEPENDENCY_FAILURE')}}),/DEPENDENCY_FAILURE/)
 assert.deepEqual(f.calls,[]);assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
})
test('busy runtime resumes without stopping or switching source',async t=>{
 const f=await fixture(t)
 f.adapter.control=async(a,action)=>{f.calls.push(action);return {idle:false}}
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_BUSY/)
 assert.deepEqual(f.calls,['prepare','drain','resume'])
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
})
test('rollback stop failure retains recovery data and never restores a live database',async t=>{
 const f=await fixture(t);let stops=0
 f.adapter.stop=async()=>{if(++stops===2)throw Error('STOP_FAILED')}
 f.adapter.status=async()=>({ready:(await readFile(join(f.target,'version'),'utf8'))==='old'})
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_ROLLBACK_FAILED/)
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 assert((await readdir(join(f.home,'.local/share/weixin-link'))).includes('upgrade.lock'))
})
test('a different release selected by a service override is not treated as the requested source',async t=>{
 const f=await fixture(t),unit=join(f.home,'legacy.service')
 await writeFile(unit,'# Managed by wechat-assistant setup v1\n')
 await assert.rejects(standardDeployment({target:f.target,home:f.home,platform:'linux',run:async()=>({stdout:`FragmentPath=${unit}\nExecStart=/usr/bin/node /custom/releases/v1/src/wechat/bot.mjs\n`})}),/UPGRADE_CUSTOM_DEPLOYMENT/)
})
test('source trees containing runtime data are refused before stopping services',async t=>{
 const f=await fixture(t)
 await writeFile(join(f.state,'installation.json'),JSON.stringify({version:1,workspace:join(f.target,'workspace')}))
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_DATA_INSIDE_SOURCE/)
 assert.deepEqual(f.calls,[])
})
test('all accounts are checked before stopping any service',async t=>{
 const f=await fixture(t)
 f.adapter.services.push({id:'busy-account',active:true})
 f.adapter.control=async(account,action)=>{f.calls.push(account.id+':'+action);return {idle:account.id!=='busy-account'}}
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_BUSY/)
 assert(!f.calls.includes('stop'));assert(f.calls.includes('default:resume'));assert(f.calls.includes('busy-account:resume'))
})
