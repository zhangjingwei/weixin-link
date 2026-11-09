import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {initInstallation} from '../../src/setup/setup-core.mjs'
import {registerLogin} from '../../src/infrastructure/accounts/account-store.mjs'
import {containerSetup,containerForAccount} from '../../src/setup/setup-container.mjs'
import {provisionContainer,containerForAccount as registeredContainer} from '../../src/infrastructure/runtime/container-environment.mjs'
test('container bootstrap prepares account-derived isolated state with an explicit unbound result',async t=>{const home=await mkdtemp(join(tmpdir(),'wechat-container-'));t.after(()=>rm(home,{recursive:true,force:true}));await initInstallation({home});await registerLogin('default',{accountId:'only-owner-bot',userId:'owner',token:'test-only'},home);const calls=[],run=async(bin,args)=>{calls.push([bin,args]);if(bin==='podman'&&args[0]==='inspect')return {stdout:JSON.stringify([{State:{Running:true}}])};if(bin==='podman'&&args[0]==='info')return {stdout:JSON.stringify({host:{security:{rootless:true},cgroupVersion:'v2',cgroupControllers:['memory']}})};return {stdout:''}};const r=await containerSetup('container-create','default',{home,run});assert.equal(r.status,'created_not_bound');assert.equal(r.loginRequired,true);const text=await readFile(join(home,'.config/containers/systemd/wechat-codex-'+r.backend+'.container'),'utf8');assert(text.includes('--memory=1536m'));assert(text.includes('--read-only'));assert(!text.includes('/.ssh'));const again=await containerSetup('container-create','default',{home,run});assert.equal(again.status,'already_created');assert.equal(calls.filter(([bin,args])=>bin==='podman'&&args[0]==='build').length,1)})
test('rootful or missing memory controllers block before building or starting services',async t=>{for(const host of [{security:{rootless:false}},{security:{rootless:true},cgroupVersion:'v2',cgroupControllers:['cpu']}]){const home=await mkdtemp(join(tmpdir(),'wechat-container-refuse-'));t.after(()=>rm(home,{recursive:true,force:true}));await initInstallation({home});await registerLogin('default',{accountId:'owner-bot',userId:'owner',token:'test-only'},home);const calls=[];await assert.rejects(containerSetup('container-create','default',{home,run:async(bin,args)=>{calls.push(args);return {stdout:JSON.stringify({host})}}}),/REQUIRED/);assert.equal(calls.length,1)}})
test('an agent spec gets its own container while isolation controls stay shared',async t=>{
 const home=await mkdtemp(join(tmpdir(),'wechat-generic-container-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 await initInstallation({home})
 await registerLogin('default',{accountId:'example-bot',userId:'owner',token:'test-only'},home)
 const spec={kind:'example',targetId:()=> 'agent-example',containerName:id=>'wechat-example-'+id,binary:'/usr/local/bin/example',image:'localhost/example:test',containerfile:'FROM scratch\n',description:'Isolated example agent',environment:['EXAMPLE_HOME=/agent/example'],exec:'/usr/local/bin/example serve'}
 const run=async(binary,args)=>binary==='podman'&&args[0]==='info'?{stdout:JSON.stringify({host:{security:{rootless:true},cgroupVersion:'v2',cgroupControllers:['memory']}})}:{stdout:''}
 const result=await provisionContainer('container-create','default',{home,spec,run})
 assert.equal(result.loginRequired,false)
 assert.equal((await registeredContainer('default',{home,spec})).id,result.backend)
 await assert.rejects(containerForAccount('default',{home}),/CONTAINER_NOT_CREATED/)
 const unit=await readFile(join(home,'.config/containers/systemd/wechat-example-agent-example.container'),'utf8')
 assert.match(unit,/--read-only --cap-drop=all --security-opt=no-new-privileges/)
 assert.match(unit,/Environment=EXAMPLE_HOME=\/agent\/example/)
 assert.doesNotMatch(unit,/CODEX_HOME|@openai\/codex/)
})
