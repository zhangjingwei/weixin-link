import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {sshCommand} from '../../src/infrastructure/remote/ssh-transport.mjs'

function fake(code,output=''){
 const calls=[]
 const spawnImpl=(binary,args)=>{
  calls.push({binary,args})
  const child=new EventEmitter()
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough()
  child.kill=()=>child.emit('close',null)
  queueMicrotask(()=>{if(output)child.stdout.write(output);child.stdout.end();child.stderr.end();child.emit('close',code)})
  return child
 }
 return {calls,spawnImpl}
}

test('SSH runner passes a fixed host alias and preserves remote exit status',async()=>{
 const {calls,spawnImpl}=fake(7,'result')
 const result=await sshCommand('server','pwd',{spawnImpl})
 assert.equal(result.exitCode,7)
 assert.equal(result.stdout.toString(),'result')
 assert.equal(calls[0].binary,'ssh')
 assert.equal(calls[0].args.at(-2),'server')
 assert.equal(calls[0].args.at(-1),'pwd')
 assert.ok(calls[0].args.includes('StrictHostKeyChecking=yes'))
 await assert.rejects(sshCommand('-oProxyCommand=bad','pwd',{spawnImpl}),/REMOTE_ARGUMENTS_INVALID/)
})

test('SSH disconnect and oversized output never report command success',async()=>{
 await assert.rejects(sshCommand('server','pwd',{spawnImpl:fake(255).spawnImpl}),/REMOTE_RESULT_UNCERTAIN/)
 await assert.rejects(sshCommand('server','pwd',{spawnImpl:fake(0,'too long').spawnImpl,maxBytes:2}),/REMOTE_OUTPUT_TOO_LARGE/)
})
