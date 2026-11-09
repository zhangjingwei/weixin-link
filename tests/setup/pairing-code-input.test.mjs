import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {PassThrough} from 'node:stream'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {readPairingCode} from '../../src/setup/pairing-code-input.mjs'
const exec=promisify(execFile)

test('pairing code can be supplied through stdin without command arguments',async()=>{
 assert.equal(await readPairingCode({input:Readable.from(['123456\n'])}),'123456')
 await assert.rejects(readPairingCode({input:Readable.from(['1'.repeat(33)])}),/INVALID_VERIFICATION_CODE/)
})

test('interactive PIN input disables terminal echo before showing its prompt',async()=>{
 const input=new PassThrough(),output=[]
 input.isTTY=true;input.isRaw=false
 input.setRawMode=value=>{input.isRaw=value}
 const result=readPairingCode({input,output:{write(text){assert(input.isRaw||text==='\n');output.push(text)}}})
 input.write('123456\r')
 assert.equal(await result,'123456')
 assert.equal(input.isRaw,false)
 assert(!output.join('').includes('123456'))
})

test('a mistyped account name reports ACCOUNT_NOT_FOUND before asking for a PIN',async t=>{
 const home=await mkdtemp(join(tmpdir(),'weixin-pin-account-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const script=fileURLToPath(new URL('../../src/setup/account-manager.mjs',import.meta.url))
 await assert.rejects(exec(process.execPath,[script,'verify','weixin-tes'],{env:{...process.env,HOME:home}}),error=>{
  assert.equal(JSON.parse(error.stdout).error,'ACCOUNT_NOT_FOUND')
  assert(!error.stderr.includes('PIN'))
  return true
 })
})
