import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {deviceLogin,openDeviceLoginPage} from '../../src/setup/setup-login.mjs'

const url='https://auth.openai.com/codex/device'
test('local device sign-in opens only the official page',async()=>{
 const calls=[],run=async(...args)=>{calls.push(args)}
 assert.equal(await openDeviceLoginPage(url,{platform:'darwin',env:{},output:{isTTY:true},run}),true)
 assert.deepEqual(calls,[['open',[url],{timeout:5000}]])
 assert.equal(await openDeviceLoginPage(url,{platform:'darwin',env:{SSH_CONNECTION:'remote'},output:{isTTY:true},run}),false)
 assert.equal(await openDeviceLoginPage('https://example.com/device',{platform:'darwin',env:{},output:{isTTY:true},run}),false)
 assert.equal(calls.length,1)
})

test('device login delivers the code, opens the page, and succeeds if opening fails',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-device-login-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const binary=join(home,'fake-codex'),marker=join(home,'authorized')
 await writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2).join(' ');const marker=${JSON.stringify(marker)};if(args==='login status')process.exit(fs.existsSync(marker)?0:1);if(args==='login --help'){console.log('--device-auth');process.exit(0)}if(args==='login --device-auth'){console.log('https://auth.openai.com/codex/device\\nABCD-EFGHI');fs.writeFileSync(marker,'yes');process.exit(0)}process.exit(1)\n`)
 await chmod(binary,0o755)
 const events=[]
 const result=await deviceLogin({binary,home,send:async message=>{assert(message.includes(url));events.push('sent');return {status:'accepted'}},openPage:async opened=>{assert.equal(opened,url);events.push('opened');throw Error('browser unavailable')}})
 assert.equal(result.status,'logged_in')
 assert.deepEqual(events,['sent','opened'])
})
