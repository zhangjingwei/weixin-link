import test from 'node:test'
import assert from 'node:assert/strict'
import {displayLoginLink} from '../../src/setup/login-link-display.mjs'

const url='https://weixin.qq.com/x/test'
const fixture=(overrides={})=>{
 const writes=[],calls=[]
 return {writes,calls,options:{output:{isTTY:true,write:text=>writes.push(text)},platform:'darwin',env:{},human:true,language:'zh',run:async(...args)=>calls.push(args),...overrides}}
}
test('desktop opens the HTTPS login address and prints only the address',async()=>{
 const f=fixture()
 await displayLoginLink({url},f.options)
 assert.deepEqual(f.calls,[['open',[url],{timeout:5000}]])
 assert(f.writes.join('').includes(url))
 assert(!f.writes.join('').includes('.png'))
})
test('browser failure and SSH retain a usable address without opening an image',async()=>{
 const failed=fixture({run:async()=>{throw Error('no browser')}})
 await displayLoginLink({url},failed.options)
 assert(failed.writes.join('').includes('手动打开'))
 const remote=fixture({env:{SSH_CONNECTION:'remote'}})
 await displayLoginLink({url},remote.options)
 assert.equal(remote.calls.length,0)
 assert(remote.writes.join('').includes(url))
})
test('invalid or missing HTTPS address fails without disclosing another value',async()=>{
 const f=fixture()
 await assert.rejects(displayLoginLink({url:'javascript:alert(1)'},f.options),/LOGIN_URL_UNAVAILABLE/)
 assert.deepEqual(f.writes,[])
})
test('redirected machine output stays silent while human output shows the address',async()=>{
 const quiet=fixture({output:{isTTY:false,write:text=>{throw Error(text)}},human:false})
 await displayLoginLink({url},quiet.options)
 const human=fixture({output:{isTTY:false,write:text=>quiet.writes.push(text)}})
 await displayLoginLink({url},human.options)
 assert(quiet.writes.join('').includes(url))
})
