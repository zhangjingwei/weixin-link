import './remote-test-config.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {windowsDeployment,deploy} from '../../src/remote/remote-deploy.mjs'
const config={platform:'win32',transport:'ssh-websocket',binary:'C:\\Users\\demo\\codex.cmd',port:47831}
test('invalid endpoints are refused before running SSH or changing a machine',async()=>{
 for(const port of [0,22,65536,47831.5,'47831; command'])assert.throws(()=>windowsDeployment({...config,port}),/INVALID/)
 for(const binary of ['relative.cmd','/tmp/codex','C:\\codex\nother.cmd'])assert.throws(()=>windowsDeployment({...config,binary}),/INVALID/)
 assert.throws(()=>windowsDeployment({...config,platform:'posix'}),/INVALID/)
 await assert.rejects(deploy('unknown-host'),/UNKNOWN_HOST/)
})
test('configuration travels as data, and the generated binary literal escapes PowerShell quotes',()=>{
 const binary="C:\\Users\\O'Brien\\codex.cmd"
 const script=windowsDeployment({...config,binary})
 const payload=script.match(/FromBase64String\('([^']+)'\)/)[1]
 assert.deepEqual(JSON.parse(Buffer.from(payload,'base64').toString()),{binary,port:47831})
 assert(!script.includes(binary))
 assert(script.includes('.Replace("\'","\'\'")'))
})
