import test from 'node:test'
import assert from 'node:assert/strict'
import {cp,mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,unlink} from 'node:fs/promises'
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
 await assert.rejects(promisify(execFile)(process.execPath,[entry],{env:{...process.env,WEIXIN_LINK_LANG:'zh'}}),error=>{
  assert.equal(error.code,1)
  assert.match(error.stderr,/用法：node src\/setup\/upgrade.mjs/)
  return true
 })
})
test('downloaded upgrade CLI loads before dependencies are installed',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weixin-upgrade-bootstrap-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const source=fileURLToPath(new URL('../../src/',import.meta.url))
 await cp(source,join(directory,'src'),{recursive:true})
 await assert.rejects(promisify(execFile)(process.execPath,[join(directory,'src/setup/upgrade.mjs')],{env:{...process.env,WEIXIN_LINK_LANG:'zh'}}),error=>{
  assert.equal(error.code,1)
  assert.match(error.stderr,/用法：node src\/setup\/upgrade.mjs/)
  return true
 })
})
test('upgrade CLI uses English when requested',async()=>{
 await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../../src/setup/upgrade.mjs',import.meta.url))],{env:{...process.env,WEIXIN_LINK_LANG:'en'}}),error=>{
  assert.match(error.stderr,/Usage: node src\/setup\/upgrade.mjs/)
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
test('upgrade stages first, removes rollback copies after success, and restarts only active services',async t=>{
 const f=await fixture(t)
 f.adapter.services.push({id:'other',active:false})
 const originalStatus=f.adapter.status
 f.adapter.status=async account=>{
  if((await readFile(join(f.target,'version'),'utf8'))==='new'){
   const [id]=await readdir(join(f.home,'.local/share/weixin-link/upgrades'))
   assert.equal(await readFile(join(f.home,'.local/share/weixin-link/upgrades',id,'state/credentials.json'),'utf8'),'original-credentials')
   assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,1)
  }
  return originalStatus(account)
 }
 const result=await upgradeInstallation(f.options)
 assert.equal(result.status,'complete')
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,0)
 assert.deepEqual(await readdir(join(f.home,'.local/share/weixin-link/upgrades')),[])
 assert.equal(await readFile(join(f.state,'credentials.json'),'utf8'),'original-credentials')
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','stop','start'])
})
test('successful cleanup leaves older unrelated backups untouched',async t=>{
 const f=await fixture(t),older=join(f.home,'installed source.backup-older'),olderRecovery=join(f.home,'.local/share/weixin-link/upgrades','older')
 await mkdir(older);await writeFile(join(older,'keep'),'old backup')
 await mkdir(olderRecovery,{recursive:true});await writeFile(join(olderRecovery,'keep'),'old recovery')
 assert.equal((await upgradeInstallation(f.options)).status,'complete')
 assert.equal(await readFile(join(older,'keep'),'utf8'),'old backup')
 assert.equal(await readFile(join(olderRecovery,'keep'),'utf8'),'old recovery')
 assert.deepEqual(await readdir(join(f.home,'.local/share/weixin-link/upgrades')),['older'])
})
test('cleanup error reports a healthy upgrade and retains remaining recovery material and lock',async t=>{
 const f=await fixture(t),messages=[]
 const result=await upgradeInstallation({...f.options,log:text=>messages.push(text),cleanupRemove:async(path,options)=>{
  if(path.startsWith(f.target+'.backup-'))throw Error('CLEANUP_DENIED')
  await rm(path,options)
 }})
 assert.deepEqual(result,{status:'complete',cleanup:'incomplete'})
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,1)
 assert.equal((await readdir(join(f.home,'.local/share/weixin-link/upgrades'))).length,1)
 assert((await readdir(join(f.home,'.local/share/weixin-link'))).includes('upgrade.lock'))
 assert(messages.some(text=>text.includes('临时回滚数据清理未完成')))
})
test('running account without a WeChat login upgrades and remains unlogged',async t=>{
 const f=await fixture(t)
 await unlink(join(f.state,'credentials.json'))
 f.adapter.status=async()=>({ready:false,draining:false,startup:'awaiting_login',instance:await readFile(join(f.target,'version'),'utf8')})
 const result=await upgradeInstallation({...f.options,healthAttempts:5})
 assert.equal(result.status,'complete')
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 await assert.rejects(readFile(join(f.state,'credentials.json'),'utf8'),{code:'ENOENT'})
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','start'])
})
test('unlogged upgrade waits for a delayed QR status response before accepting startup',async t=>{
 const f=await fixture(t)
 let checks=0
 f.adapter.status=async()=>{
  const version=await readFile(join(f.target,'version'),'utf8')
  if(version==='new')checks++
  return {ready:false,instance:version,startup:version==='new'&&checks<40?'login_in_progress':'awaiting_login'}
 }
 const result=await upgradeInstallation({...f.options,healthAttempts:30})
 assert.equal(result.status,'complete')
 assert(checks>=44)
})
test('unlogged account still rolls back when the new control endpoint is unavailable',async t=>{
 const f=await fixture(t)
 let generation=0
 f.adapter.start=async()=>{generation++;f.calls.push('start')}
 f.adapter.status=async()=>{
  if((await readFile(join(f.target,'version'),'utf8'))==='new')throw Error('CONTROL_UNAVAILABLE')
  return {ready:false,draining:false,instance:`old-${generation}`}
 }
 await assert.rejects(upgradeInstallation({...f.options,healthAttempts:5}),/UPGRADE_HEALTH_CHECK_FAILED/)
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','start','stop','start'])
})
test('unlogged upgrade rolls back when startup only responds briefly',async t=>{
 const f=await fixture(t)
 let generation=0,newChecks=0
 f.adapter.start=async()=>{generation++;f.calls.push('start')}
 f.adapter.status=async()=>{
  if((await readFile(join(f.target,'version'),'utf8'))==='new'){
   newChecks++
   if(newChecks===1)return {ready:false,startup:'initializing',instance:'new'}
   if(newChecks===2)return {ready:false,startup:'awaiting_login',instance:'new'}
   throw Error('STARTUP_FAILED')
  }
  return {ready:false,instance:`old-${generation}`}
 }
 await assert.rejects(upgradeInstallation({...f.options,healthAttempts:6}),/UPGRADE_HEALTH_CHECK_FAILED/)
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
 assert.deepEqual(f.calls,['prepare','drain','seal','stop','start','stop','start'])
})
test('repeating the same upgrade skips prepare and service restart',async t=>{
 const f=await fixture(t)
 await upgradeInstallation(f.options)
 const before=await readdir(join(f.home,'.local/share/weixin-link/upgrades'))
 const calls=[...f.calls]
 await mkdir(join(f.target,'node_modules'))
 await writeFile(join(f.target,'node_modules','installed'),'dependency')
 const result=await upgradeInstallation(f.options)
 assert.equal(result.status,'up_to_date')
 assert.deepEqual(f.calls,calls)
 assert.deepEqual(await readdir(join(f.home,'.local/share/weixin-link/upgrades')),before)
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,0)
 assert(!(await readdir(join(f.home,'.local/share/weixin-link'))).includes('upgrade.lock'))
})
test('matching source still refuses an unmanaged target',async t=>{
 const f=await fixture(t)
 await writeFile(join(f.target,'version'),'new')
 await writeFile(join(f.target,'.env'),'private')
 await assert.rejects(upgradeInstallation(f.options),/UPGRADE_CUSTOM_SOURCE/)
 assert.deepEqual(f.calls,[])
})
test('changed installed content still runs the upgrade even with the same package version',async t=>{
 const f=await fixture(t)
 await upgradeInstallation(f.options)
 await writeFile(join(f.target,'version'),'modified')
 const result=await upgradeInstallation(f.options)
 assert.equal(result.status,'complete')
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'new')
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,0)
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
 assert.deepEqual(await readdir(join(f.home,'.local/share/weixin-link/upgrades')),[])
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,0)
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
 const [id]=await readdir(join(f.home,'.local/share/weixin-link/upgrades'))
 assert.equal(await readFile(join(f.home,'.local/share/weixin-link/upgrades',id,'state/credentials.json'),'utf8'),'original-credentials')
 assert.equal((await readdir(f.home)).filter(name=>name.startsWith('installed source.backup-')).length,1)
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

test('local snapshot becomes visible only after healthy startup and survives a no-op upgrade',async t=>{
 const f=await fixture(t)
 const marker='.weixin-link-local-update.json',snapshot=JSON.stringify({version:1,tree:'b'.repeat(40)})
 await writeFile(join(f.source,marker),snapshot)
 f.adapter.start=async()=>assert.rejects(readFile(join(f.target,marker)),{code:'ENOENT'})
 const options={...f.options,localUpdate:true}
 assert.equal((await upgradeInstallation(options)).status,'complete')
 assert.equal(await readFile(join(f.target,marker),'utf8'),snapshot)
 assert.equal((await upgradeInstallation(options)).status,'up_to_date')
})

test('failed local update restores the previous notification marker',async t=>{
 const f=await fixture(t),marker='.weixin-link-local-update.json'
 await writeFile(join(f.target,marker),'old marker')
 await writeFile(join(f.source,marker),'new marker')
 f.adapter.status=async()=>({ready:(await readFile(join(f.target,'version'),'utf8'))==='old'})
 await assert.rejects(upgradeInstallation({...f.options,localUpdate:true}),/UPGRADE_HEALTH_CHECK_FAILED/)
 assert.equal(await readFile(join(f.target,marker),'utf8'),'old marker')
})

test('personal upgrade detects a running legacy service before changing either installation',async t=>{
 const f=await fixture(t),unit=join(f.home,'managed.service'),legacy=join(f.state,'accounts','older')
 await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'account.json'),'{"id":"older"}')
 await writeFile(unit,'# Managed by wechat-assistant setup v1\n')
 const run=async(_exe,args)=>({stdout:args.includes('--property=FragmentPath')?
  'FragmentPath='+unit+'\nExecStart=/usr/bin/node '+join(f.target,'src/wechat/bot.mjs')+'\n':'ActiveState=active\nMainPID=1\n'})
 await assert.rejects(standardDeployment({target:f.target,home:f.home,platform:'linux',run}),/UPGRADE_ACTIVE_LEGACY_ACCOUNT/)
 assert.equal(await readFile(join(f.target,'version'),'utf8'),'old')
})
