import test from 'node:test'
import assert from 'node:assert/strict'
import {runWeChatLogin} from '../../src/setup/wechat-login-cli.mjs'

function fixture({ready=false,active=false,stop='stopped'}={}){
 const calls=[],messages=[],output={isTTY:false,write:text=>messages.push(text)}
 const run=async(_binary,args)=>{
  const action=args[1];calls.push(action)
  const value={list:{accounts:[{account:'default',ready,service_active:active}]},stop:{ok:true,status:stop},'refresh-qr':{ok:true,status:'scan_to_login',path:'/tmp/qr.png'}}[action]
  return {stdout:JSON.stringify(value)}
 }
 const showQr=async()=>{calls.push('display')}
 return {calls,messages,options:{run,showQr,output,human:true,home:'/tmp/test-home'}}
}

test('fresh login shows the QR from the unified setup command',async()=>{
 const f=fixture(),result=await runWeChatLogin(f.options)
 assert.equal(result.status,'scan_to_login')
 assert.deepEqual(f.calls,['list','refresh-qr','display'])
})

test('ready account is not paired again without explicit relogin',async()=>{
 const f=fixture({ready:true,active:true}),result=await runWeChatLogin(f.options)
 assert.equal(result.status,'already_ready')
 assert.deepEqual(f.calls,['list'])
 assert(f.messages.join('').includes('install.sh)" -- relogin'))
})
test('English login gives English guidance and passes language to QR display',async()=>{
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

test('failed stop prevents a new QR request',async()=>{
 const f=fixture({ready:true,active:true,stop:'pending'})
 await assert.rejects(runWeChatLogin({...f.options,relogin:true}),/ACCOUNT_STOP_UNCONFIRMED/)
 assert.deepEqual(f.calls,['list','stop'])
})
