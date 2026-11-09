import {isPipe} from './control-endpoint.mjs'
import {lstat,readFile,writeFile} from 'node:fs/promises'
import {accountPaths,listAccounts} from '../accounts/account-store.mjs'
import http from 'node:http'
import net from 'node:net'
import {randomUUID} from 'node:crypto'
import {chmod,unlink} from 'node:fs/promises'
import {dirname} from 'node:path'

const sameSocket=(a,b)=>a.dev===b.dev&&a.ino===b.ino
async function removeStaleSocket(path){
 let original
 try{original=await lstat(path)}catch(error){if(error.code==='ENOENT')return;throw error}
 if(!original.isSocket())throw Error('RUNTIME_SOCKET_UNSAFE')
 const stale=await new Promise((resolve,reject)=>{
  const socket=net.createConnection(path)
  socket.setTimeout(1000)
  socket.once('connect',()=>{socket.destroy();resolve(false)})
  socket.once('timeout',()=>{socket.destroy();reject(Error('RUNTIME_SOCKET_UNCONFIRMED'))})
  socket.once('error',error=>error.code==='ECONNREFUSED'?resolve(true):error.code==='ENOENT'?resolve(null):reject(error))
 })
 if(stale===null)return
 if(!stale)throw Error('RUNTIME_ALREADY_RUNNING')
 const current=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error})
 if(current){if(!current.isSocket()||!sameSocket(original,current))throw Error('RUNTIME_SOCKET_CHANGED');await unlink(path)}
}

/** Private, live control plane. Logs never participate in restart decisions. */
export class RuntimeControl {
 constructor({snapshot,ready=()=>false,onSeal,onResume,onDrainRelease=()=>{},onRemoteText=async()=>{throw Error("Unavailable")},onSchedule=async()=>{throw Error('Unavailable')},features={},backend=null,now=Date.now}={}){
  this.canSeal=typeof snapshot==='function'&&typeof onSeal==='function'&&typeof onResume==='function'
  Object.assign(this,{snapshot:snapshot??(()=>({})),ready,onSeal:onSeal??(()=>{}),onResume:onResume??(()=>{}),onDrainRelease,onRemoteText,onSchedule,features,backend,now});this.instance=randomUUID();this.counts={};this.lease=null;this.sealed=false
 }
 get draining(){
  if(this.lease&&!this.sealed&&this.lease.expires<=this.now()){this.lease=null;queueMicrotask(()=>{if(!this.lease)this.onDrainRelease()})}
  return !!this.lease
 }
 enter(kind){this.counts[kind]=(this.counts[kind]??0)+1;let done=false;return ()=>{if(!done){done=true;this.counts[kind]--}}}
 async track(kind,work){const leave=this.enter(kind);try{return await work()}finally{leave()}}
 status(){
  const draining=this.draining,counts={...this.counts,...this.snapshot()}
  const idle=Object.values(counts).every(n=>Number.isFinite(n)&&n===0)
  return {pid:process.pid,instance:this.instance,ready:!!this.ready(),features:this.features,backend:this.backend,draining,sealed:this.sealed,idle,counts}
 }
 command(action,lease){
  if(typeof lease!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(lease))throw Object.assign(Error('Invalid lease'),{statusCode:400})
  void this.draining
  if(this.lease&&this.lease.id!==lease)throw Object.assign(Error('Maintenance already owned'),{statusCode:409})
  if(action==='drain'){this.lease={id:lease,expires:this.now()+120000};return this.status()}
  if(!this.lease)throw Object.assign(Error('Drain required'),{statusCode:409})
  if(action==='seal'){
   if(!this.canSeal)throw Object.assign(Error('Maintenance callbacks required'),{statusCode:409})
   if(!this.status().idle)throw Object.assign(Error('Service busy'),{statusCode:409})
   this.sealed=true;this.onSeal();return this.status()
  }
  if(action==='resume'){const wasSealed=this.sealed;this.lease=null;this.sealed=false;if(wasSealed)this.onResume();else this.onDrainRelease();return this.status()}
  throw Object.assign(Error('Unknown command'),{statusCode:404})
 }
 async listen(path){
  this.path=path
  if(isPipe(path)){this.token=randomUUID();await writeFile(accountPaths().stateDir+'/control-token',this.token,{mode:0o600})}
  else{
   const {default:lockfile}=await import('proper-lockfile')
   this.releaseSocketLock=await lockfile.lock(dirname(path),{lockfilePath:path+'.instance-lock',stale:30000,update:10000,retries:0}).catch(error=>{if(error.code==='ELOCKED')throw Error('RUNTIME_ALREADY_RUNNING');throw error})
   try{await removeStaleSocket(path)}catch(error){await this.releaseSocketLock();this.releaseSocketLock=null;throw error}
  }
  this.server=http.createServer(async(req,res)=>{
   try{
    if(this.token&&req.headers['x-control-token']!==this.token)throw Object.assign(Error('Unauthorized'),{statusCode:403})
    let result
    if(req.method==='GET'&&req.url==='/status')result=this.status()
    else if(req.method==='POST'&&req.url==='/remote-text'){let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Object.assign(Error('Too large'),{statusCode:413})}result=await this.onRemoteText(JSON.parse(body))}
    else if(req.method==='POST'&&req.url==='/schedules'){
     if(this.sealed||this.draining)throw Object.assign(Error('Unavailable'),{statusCode:409})
     let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Object.assign(Error('Too large'),{statusCode:413})}
     result=await this.track('schedule',()=>this.onSchedule(JSON.parse(body)))
    }
    else if(req.method==='POST'&&['/drain','/seal','/resume'].includes(req.url)){
     let body='';for await(const chunk of req){body+=chunk;if(body.length>512)throw Object.assign(Error('Too large'),{statusCode:413})}
     result=this.command(req.url.slice(1),JSON.parse(body).lease)
    }else throw Object.assign(Error('Not found'),{statusCode:404})
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))
   }catch(error){res.writeHead(error.statusCode??400,{'content-type':'application/json'});res.end(JSON.stringify({error:/^SCHEDULE_[A-Z_]+$/.test(error.message)?error.message:'CONTROL_REQUEST_REJECTED'}))}
  })
  this.server.requestTimeout=3000;this.server.headersTimeout=3000
  try{
   await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(path,resolve)})
   if(!isPipe(path)){this.socketIdentity=await lstat(path);await chmod(path,0o600)}
  }catch(error){if(this.server?.listening)await new Promise(resolve=>this.server.close(resolve));await this.releaseSocketLock?.();this.releaseSocketLock=null;throw error}
 }
 async close(){
  if(this.server?.listening)await new Promise(resolve=>this.server.close(resolve))
  if(this.path&&!isPipe(this.path)){
   const current=await lstat(this.path).catch(error=>{if(error.code==='ENOENT')return null;throw error})
   if(current&&this.socketIdentity&&sameSocket(current,this.socketIdentity))await unlink(this.path)
  }
  await this.releaseSocketLock?.();this.releaseSocketLock=null
 }
}
async function tokenFile(socket){for(const p of await listAccounts())if(p.socket===socket)return p.stateDir+'/control-token';throw Error('UNKNOWN_CONTROL_ENDPOINT')}
export async function controlRequest(socketPath,method,path,body,timeoutMs=2500){
 const headers=isPipe(socketPath)?{'x-control-token':await readFile(await tokenFile(socketPath),'utf8')}:{}
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,method,path,headers,timeout:timeoutMs},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>65536)res.destroy(Error('Oversized control response'))});res.on('error',reject)
   res.on('end',()=>{if(res.statusCode!==200){let safe='CONTROL_REJECTED';try{const parsed=JSON.parse(text);if(/^SCHEDULE_[A-Z_]+$/.test(parsed.error))safe=parsed.error}catch{}reject(Object.assign(Error(safe),{code:safe,statusCode:res.statusCode}));return}try{resolve(JSON.parse(text))}catch(error){reject(error)}})
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Object.assign(Error('Control timeout'),{code:'ETIMEDOUT'})));req.end(body?JSON.stringify(body):undefined)
 })
}
