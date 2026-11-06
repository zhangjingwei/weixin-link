import test from 'node:test'
import assert from 'node:assert/strict'
import {nonBlockingHandler} from '../../src/wechat/message-handler.mjs'
test('a serial SDK update batch can deliver stop while earlier intake is blocked',async()=>{
 let release,stopped=false
 const callback=nonBlockingHandler(async message=>{if(message==='slow')await new Promise(r=>{release=r});else stopped=true})
 for(const message of ['slow','stop'])await callback(message)
 await new Promise(r=>setImmediate(r));assert.equal(stopped,true);release()
})
test('background handler failures are caught without rejecting SDK dispatch',async()=>{
 let failures=0;const callback=nonBlockingHandler(async()=>{throw Error('test')},()=>{failures++})
 assert.equal(callback('message'),undefined);await new Promise(r=>setImmediate(r));assert.equal(failures,1)
})
test('ingress is reserved synchronously and released after error handling',async()=>{
 let count=0,release
 const callback=nonBlockingHandler(async()=>new Promise(r=>{release=r}),()=>{},{enter:()=>{count++;return ()=>count--}})
 callback('message');assert.equal(count,1);await new Promise(r=>setImmediate(r));release();await new Promise(r=>setImmediate(r));assert.equal(count,0)
})
