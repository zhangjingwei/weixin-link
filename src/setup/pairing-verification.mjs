import {setTimeout as delay} from 'node:timers/promises'

const CHALLENGES=new Set(['verification_code_required','verification_code_rejected'])
const FAILURES=new Set(['pairing_stopped','qr_write_failed','LOGIN_OR_START_FAILED','VERIFICATION_TIMEOUT','WECHAT_SERVICE_NOT_READY'])

// Keep the QR command alive until the SDK asks for a PIN or login finishes.
export async function waitForPairingVerification({status,readCode,submitCode,wait=delay,now=Date.now,timeoutMs=300000,signal}={}){
 const deadline=now()+timeoutMs
 let handled=null,submitted=false
 while(now()<deadline){
  if(signal?.aborted)throw Error('VERIFICATION_CANCELLED')
  const current=await status()
  if(current.status==='service_started')return {status:'login_complete',pin_submitted:submitted}
  if(FAILURES.has(current.status))throw Error(current.status==='pairing_stopped'?'PAIRING_STOPPED':current.status)
  if(current.running===false)throw Error('PAIRING_STOPPED')
  if(CHALLENGES.has(current.status)){
   const marker=current.status+':'+current.updated_at
   if(marker!==handled){
    const code=await readCode()
    if(!/^\d{4,12}$/.test(code))throw Error('INVALID_VERIFICATION_CODE')
    await submitCode(code)
    handled=marker;submitted=true
   }
  }
  await wait(1000)
 }
 throw Error('VERIFICATION_WAIT_TIMEOUT')
}
