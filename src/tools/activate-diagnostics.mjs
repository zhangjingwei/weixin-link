import {ServiceManager} from '../setup/platform-service.mjs'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
// External controller: live drain/seal handshake over a private Unix socket, never logs.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {writeFile,mkdir} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {controlRequest} from '../infrastructure/runtime/runtime-control.mjs'
const exec=promisify(execFile),dir=accountPaths().stateDir,socket=accountPaths().socket,lease=randomUUID()
const request=(method,path,body)=>controlRequest(socket,method,path,body)
const services=new ServiceManager()
const mainPid=async()=>{const state=await services.status(accountPaths().service);if(!state.active)return 0;if(state.pid)return state.pid;return (await request('GET','/status')).pid}
await mkdir(dir,{recursive:true,mode:0o700})
let result,old,drained=false,restarted=false
try{
 const pid=await mainPid()
 try{old=await request('GET','/status')}catch(error){
  // Explicit one-time migration only: the old binary has no control endpoint.
  if(!process.argv.includes('--bootstrap')||!['ENOENT','ECONNREFUSED'].includes(error.code))throw error
  await delay(30000)
  if(await mainPid()!==pid)throw Object.assign(Error('Process changed'),{code:'PID_CHANGED'})
 }
 if(old){
  if(old.pid!==pid||(!old.ready&&!process.argv.includes('--stop')))throw Object.assign(Error('Runtime mismatch'),{code:'RUNTIME_NOT_READY'})
  let sealed=false
  for(let i=0;i<600;i++){
   const state=await request('POST','/drain',{lease});drained=true
   if(state.pid!==pid||state.instance!==old.instance)throw Object.assign(Error('Process changed'),{code:'PID_CHANGED'})
   if(state.idle){try{await request('POST','/seal',{lease});sealed=true;break}catch(error){if(error.statusCode!==409)throw error}}
   await delay(1000)
  }
  if(!sealed)throw Object.assign(Error('Busy'),{code:'RESTART_DEFERRED_BUSY'})
 }
 if(await mainPid()!==pid)throw Object.assign(Error('Process changed'),{code:'PID_CHANGED'})
 await services[process.argv.includes('--stop')?'stop':'restart'](accountPaths().service);restarted=true
 if(process.argv.includes('--stop')){const stopped=await mainPid()===0;result={checked_at:new Date().toISOString(),status:stopped?'verified':'not_verified',service_active:false,mode:'stopped'}}else{
 let verified=false,newPid,features
 for(let i=0;i<30;i++){
  try{
   newPid=await mainPid();const state=await request('GET','/status')
   features=state.features;const required=(process.argv.find(v=>v.startsWith('--require-features='))??'').split('=')[1]?.split(',')??[]
   verified=required.every(name=>features?.[name]===true)&&newPid!==pid&&state.pid===newPid&&state.instance!==old?.instance&&state.ready&&!state.draining
   if(verified)break
  }catch{}
  await delay(1000)
 }
 result={checked_at:new Date().toISOString(),status:verified?'verified':'not_verified',service_active:verified,login_confirmed:verified,features,pid:newPid,mode:old?'live_handshake':'bootstrap'}
 }
}catch(error){
 result={checked_at:new Date().toISOString(),status:'failed',code:['RESTART_DEFERRED_BUSY','PID_CHANGED','RUNTIME_NOT_READY','ENOENT','ECONNREFUSED','ETIMEDOUT','CONTROL_REJECTED'].includes(error.code)?error.code:'ACTIVATION_FAILED'}
}finally{
 if(drained&&!restarted)try{await request('POST','/resume',{lease})}catch{}
}
await writeFile(join(dir,'activation-check.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600})
if(result.status!=='verified')process.exitCode=1
