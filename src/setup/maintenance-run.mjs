import {spawn,execFile} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
export async function terminateMaintenance(child){if(!child?.pid||child.exitCode!==null||child.signalCode)return;if(process.platform==='win32'){await new Promise((resolve,reject)=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{timeout:10000},error=>{if(error&&child.exitCode===null)reject(error);else resolve()}));return}const signal=s=>{try{process.kill(process.platform!=='win32'?-child.pid:child.pid,s)}catch(e){if(e.code!=='ESRCH')throw e}};signal('SIGTERM');await delay(200);signal('SIGKILL')}
export async function maintenanceRun(binary,args,{signal,timeout=300000,maxBuffer=1024*1024,cwd,env=process.env}={}){
 signal?.throwIfAborted();const child=spawn(binary,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let stopping,cancelled=false,output='',errors='',tooLarge=false
 const stop=()=>{cancelled=true;stopping??=terminateMaintenance(child);void stopping.catch(()=>{})};const timer=setTimeout(stop,timeout);signal?.addEventListener('abort',stop,{once:true})
 const result=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)+Buffer.byteLength(errors)>maxBuffer){tooLarge=true;stop()}})
  child.stderr.on('data',chunk=>{errors+=chunk;if(Buffer.byteLength(output)+Buffer.byteLength(errors)>maxBuffer){tooLarge=true;stop()}})
  child.on('error',error=>reject(error));child.on('close',code=>{if(cancelled)reject(Error(tooLarge?'SETUP_OUTPUT_LIMIT':'SETUP_CANCELLED'));else if(code!==0)reject(Object.assign(Error('SETUP_COMMAND_FAILED'),{code,stdout:output,stderr:errors}));else resolve({stdout:output,stderr:errors})})
 })
 try{return await result}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(stopping)await stopping}
}
