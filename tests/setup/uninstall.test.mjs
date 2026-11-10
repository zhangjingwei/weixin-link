import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {uninstallInstallation} from '../../src/setup/uninstall.mjs'

test('uninstall removes managed Linux services and keeps account data and workspace',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-uninstall-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,'source'),units=join(home,'.config/systemd/user'),accounts=join(home,'.local/share/wechat-ping-bot/accounts/bot2'),workspace=join(home,'work')
 await Promise.all([mkdir(root,{recursive:true}),mkdir(units,{recursive:true}),mkdir(accounts,{recursive:true}),mkdir(workspace,{recursive:true})])
 await writeFile(join(root,'package.json'),'{"name":"weixin-link"}')
 await writeFile(join(accounts,'credential'),'private')
 await writeFile(join(workspace,'file'),'work')
 for(const name of ['wechat-ping-bot.service','wechat-ping-bot@.service'])await writeFile(join(units,name),`# Managed by wechat-assistant setup v1\nWorkingDirectory=${root}\n`)
 const calls=[]
 await uninstallInstallation({home,root,platform:'linux',run:async(binary,args)=>{calls.push([binary,...args]);return {stdout:args.includes('is-active')?'inactive\n':''}}})
 assert(calls.some(call=>call.includes('wechat-ping-bot@bot2.service')))
 await assert.rejects(readFile(join(units,'wechat-ping-bot.service')),{code:'ENOENT'})
 assert.equal(await readFile(join(accounts,'credential'),'utf8'),'private')
 assert.equal(await readFile(join(workspace,'file'),'utf8'),'work')
})

test('uninstall leaves an unmanaged service untouched',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-uninstall-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,'source'),units=join(home,'.config/systemd/user')
 await Promise.all([mkdir(root,{recursive:true}),mkdir(units,{recursive:true})])
 await writeFile(join(root,'package.json'),'{"name":"weixin-link"}')
 await writeFile(join(units,'wechat-ping-bot.service'),'custom service')
 let called=false
 await assert.rejects(uninstallInstallation({home,root,platform:'linux',run:async()=>{called=true}}),/UNINSTALL_SERVICE_REQUIRES_REVIEW/)
 assert.equal(called,false)
 assert.equal(await readFile(join(units,'wechat-ping-bot.service'),'utf8'),'custom service')
})

test('uninstall removes a managed macOS launch agent without touching account data',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-uninstall-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,'source'),agents=join(home,'Library/LaunchAgents'),state=join(home,'.local/share/wechat-ping-bot')
 await Promise.all([mkdir(root,{recursive:true}),mkdir(agents,{recursive:true}),mkdir(state,{recursive:true})])
 await writeFile(join(root,'package.json'),'{"name":"weixin-link"}')
 await writeFile(join(state,'private'),'kept')
 const plist=join(agents,'com.wechat-assistant.wechat-ping-bot.plist')
 await writeFile(plist,`<!-- Managed by wechat-assistant setup v1 -->\n<string>${root}</string>`)
 const calls=[]
 await uninstallInstallation({home,root,platform:'darwin',manager:{domain:'gui/42'},run:async(binary,args)=>{calls.push([binary,...args]);if(args[0]==='print')throw Error('not loaded');return {stdout:''}}})
 assert(calls.some(call=>call[1]==='bootout'))
 await assert.rejects(readFile(plist),{code:'ENOENT'})
 assert.equal(await readFile(join(state,'private'),'utf8'),'kept')
})

test('an interrupted installation without services can be uninstalled',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-uninstall-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,'source')
 await mkdir(root,{recursive:true})
 await writeFile(join(root,'package.json'),'{"name":"weixin-link"}')
 const commands=[]
 const run=async(binary,args)=>{commands.push([binary,...args]);return {stdout:''}}
 assert.deepEqual(await uninstallInstallation({home,root,platform:'darwin',run}),{servicesRemoved:false,accountDataPreserved:true,workspacePreserved:true})
 assert.deepEqual(await uninstallInstallation({home,root,platform:'linux',run}),{servicesRemoved:false,accountDataPreserved:true,workspacePreserved:true})
 assert(commands.some(command=>command[0]==='launchctl'))
 assert(commands.some(command=>command[0]==='systemctl'))
})
