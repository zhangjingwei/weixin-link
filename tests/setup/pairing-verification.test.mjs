import test from 'node:test'
import assert from 'node:assert/strict'
import {waitForPairingVerification} from '../../src/setup/pairing-verification.mjs'

function fixture(states,codes=[]){
 let time=0,index=0
 const submitted=[]
 return {
  submitted,
  options:{
   status:async()=>states[Math.min(index++,states.length-1)],
   readCode:async()=>codes.shift(),
   submitCode:async code=>submitted.push(code),
   wait:async()=>{time+=1000},now:()=>time,timeoutMs:10000,
  },
 }
}

test('QR command finishes without a PIN when WeChat confirms directly',async()=>{
 const f=fixture([{status:'waiting_scan',running:true},{status:'service_started',running:false}])
 assert.deepEqual(await waitForPairingVerification(f.options),{status:'login_complete',pin_submitted:false})
 assert.deepEqual(f.submitted,[])
})

test('QR command submits the PIN only on a challenge and handles a rejected code',async()=>{
 const f=fixture([
  {status:'waiting_scan',running:true},
  {status:'verification_code_required',updated_at:'first',running:true},
  {status:'verification_code_required',updated_at:'first',running:true},
  {status:'verification_code_rejected',updated_at:'second',running:true},
  {status:'service_started',running:false},
 ],['123456','234567'])
 assert.deepEqual(await waitForPairingVerification(f.options),{status:'login_complete',pin_submitted:true})
 assert.deepEqual(f.submitted,['123456','234567'])
})

test('stopped pairing does not request or submit a PIN',async()=>{
 const f=fixture([{status:'pairing_stopped',running:false}],['123456'])
 await assert.rejects(waitForPairingVerification(f.options),/PAIRING_STOPPED/)
 assert.deepEqual(f.submitted,[])
})
test('service readiness failure keeps its diagnostic code',async()=>{
 const f=fixture([{status:'WECHAT_SERVICE_NOT_READY',running:false}])
 await assert.rejects(waitForPairingVerification(f.options),/WECHAT_SERVICE_NOT_READY/)
})
