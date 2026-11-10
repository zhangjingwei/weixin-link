import test from 'node:test'
import assert from 'node:assert/strict'
import {runWeChatLogin,waitForLogin} from '../../src/setup/wechat-login-cli.mjs'
import {EventEmitter} from 'node:events'

function fixture({ready=false,active=false,stop='stopped'}={}){
 const calls=[],messages=[],output={isTTY:false,write:text=>messages.push(text)}
 const run=async(_binary,args)=>{
  const action=args[1];calls.push(action)
  const value={list:{accounts:[{account:'default',ready,service_active:active}]},stop:{ok:true,status:stop},'refresh-qr':{ok:true,status:'scan_to_login',url:'https://weixin.qq.com/x/test'}}[action]
  return {stdout:JSON.stringify(value)}
 }
 const showLoginLink=async()=>{calls.push('display')}
 return {calls,messages,options:{run,showLoginLink,output,human:true,home:'/tmp/test-home'}}
}

test('fresh login shows the login link from the unified setup command',async()=>{
 const f=fixture(),result=await runWeChatLogin(f.options)
 assert.equal(result.status,'scan_to_login')
 assert.deepEqual(f.calls,['list','refresh-qr','display'])
})

test('ready account is not paired again without explicit relogin',async()=>{
 const f=fixture({ready:true,active:true}),result=await runWeChatLogin(f.options)
 assert.equal(result.status,'already_ready')
 assert.deepEqual(f.calls,['list'])
 assert(f.messages.join('').includes('install.sh | WEIXIN_LINK_LANG=zh sh'))
})
test('English login gives English guidance and passes language to link display',async()=>{
 const f=fixture({ready:true,active:true})
 const result=await runWeChatLogin({...f.options,language:'en'})
 assert.equal(result.status,'already_ready')
 assert(f.messages.join('').includes('local service is ready'))
})

test('explicit relogin safely stops only the selected account before pairing',async()=>{
 const f=fixture({ready:true,active:true}),result=await runWeChatLogin({...f.options,relogin:true})
 assert.equal(result.status,'scan_to_login')
 assert.deepEqual(f.calls,['list','stop','refresh-qr','display'])
})

test('failed stop prevents a new login request',async()=>{
 const f=fixture({ready:true,active:true,stop:'pending'})
 await assert.rejects(runWeChatLogin({...f.options,relogin:true}),/ACCOUNT_STOP_UNCONFIRMED/)
 assert.deepEqual(f.calls,['list','stop'])
})
test('a stopped pairing worker accepts a ready account service',async()=>{
 const start=()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',1));return child}
 const run=async()=>({stdout:JSON.stringify({accounts:[{account:'default',ready:true,pairing:'WECHAT_SERVICE_NOT_READY'}]})})
 await waitForLogin('default',{start,run,language:'zh'})
})
test('a stopped pairing worker reports service startup failure',async()=>{
 const start=()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',1));return child}
 const run=async()=>({stdout:JSON.stringify({accounts:[{account:'default',ready:false,pairing:'WECHAT_SERVICE_NOT_READY'}]})})
 await assert.rejects(waitForLogin('default',{start,run,language:'zh'}),/WECHAT_SERVICE_NOT_READY/)
})
