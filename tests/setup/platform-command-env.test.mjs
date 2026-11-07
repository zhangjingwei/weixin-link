import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {dirname,delimiter} from 'node:path'
import {npmCommand,nodeEnvironment} from '../../src/setup/platform-command.mjs'
test('npm and child node run without a login-shell PATH',()=>{
 const env=nodeEnvironment({...process.env,PATH:process.platform==='win32'?process.env.SystemRoot+'\\System32':'/usr/bin:/bin:/usr/sbin:/sbin'})
 const command=npmCommand(['--version'])
 assert.match(execFileSync(command.binary,command.args,{env,encoding:'utf8',timeout:10000}).trim(),/^\d+\.\d+\.\d+/)
 assert.equal(env.PATH.split(delimiter)[0],dirname(process.execPath))
 assert.equal(execFileSync('node',['-p','process.version'],{env,encoding:'utf8',timeout:10000}).trim(),process.version)
})
