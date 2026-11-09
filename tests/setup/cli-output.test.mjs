import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setupMessage,setupError} from '../../src/setup/cli-output.mjs'
const exec=promisify(execFile)
const cli=fileURLToPath(new URL('../../src/setup/setup.mjs',import.meta.url))

test('installation CLI offers readable progress while retaining its JSON interface', {skip:process.platform==='win32'}, async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-cli-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const options={env:{...process.env,HOME:home}}
 const human=await exec(process.execPath,[cli,'init','--human'],options)
 assert(human.stdout.includes('[1/5]'))
 assert(human.stdout.includes('工作目录已准备'))
 assert(!human.stdout.includes('"initialized"'))
 const machine=await exec(process.execPath,[cli,'init'],options)
 assert.equal(JSON.parse(machine.stdout).initialized,true)
})
test('human errors retain exit failure and a diagnostic code without raw JSON', async()=>{
 await assert.rejects(exec(process.execPath,[cli,'init','relative-path','--human']),error=>{
  assert.equal(error.code,1)
  assert(error.stderr.includes('有效的绝对路径'))
  assert(error.stderr.includes('INVALID_WORKSPACE'))
  assert(!error.stderr.includes('"ok"'))
  return true
 })
 await assert.rejects(exec(process.execPath,[cli,'init','relative-path']),error=>{
  assert.equal(JSON.parse(error.stderr).error,'INVALID_WORKSPACE')
  return true
 })
})
test('pairing prompts distinguish an existing login and explain the next step',()=>{
 assert(setupMessage('pair',{status:'already_pairing'}).includes('已在进行'))
 assert(setupMessage('qr').includes('安装状态'))
 assert(setupMessage('qr').includes('account-manager.mjs verify'))
 assert(setupError(Error('VERIFICATION_NOT_REQUESTED')).includes('尚未要求输入 PIN'))
 assert(setupError(Error('ACCOUNT_NOT_FOUND')).includes('核对账号名'))
 assert(setupMessage('verify-wait',{pin_submitted:true}).includes('PIN 已提交'))
 assert(setupError(Error('QR_NOT_READY_OR_EXPIRED')).includes('刷新二维码'))
 assert(!setupError(Error('sensitive raw process output')).includes('sensitive'))
})
test('service conflicts identify the preserved file and do not suggest a network failure',()=>{
 const error=Object.assign(Error('EXISTING_SERVICE_REQUIRES_REVIEW'),{servicePath:'/home/test/.config/systemd/user/wechat-ping-bot.service'})
 const text=setupError(error)
 assert(text.includes('已保留原配置'))
 assert(text.includes(error.servicePath))
 assert(!text.includes('网络'))
})
