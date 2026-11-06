import {isPipe} from './control-endpoint.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {accountPaths,listAccounts} from '../../wechat/accounts.mjs'
import http from 'node:http'
import {randomUUID} from 'node:crypto'
import {chmod,unlink} from 'node:fs/promises'

/** Private, live control plane. Logs never participate in restart decisions. */
export class RuntimeControl {
 constructor({snapshot=()=>({}),ready=()=>false,onSeal=()=>{},onResume=()=>{},onRemoteText=async()=>{throw Error("Unavailable")},features={},backend=null,now=Date.now}={}){
  Object.assign(this,{snapshot,ready,onSeal,onResume,onRemoteText,features,backend,now});this.instance=randomUUID();this.counts={};this.lease=null;this.sealed=false
 }
 get draining(){
  if(this.lease&&!this.sealed&&this.lease.expires<=this.now())this.lease=null
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
   if(!this.status().idle)throw Object.assign(Error('Service busy'),{statusCode:409})
   this.sealed=true;this.onSeal();return this.status()
  }
  if(action==='resume'){const wasSealed=this.sealed;this.lease=null;this.sealed=false;if(wasSealed)this.onResume();return this.status()}
  throw Object.assign(Error('Unknown command'),{statusCode:404})
 }
 async listen(path){
  this.path=path;if(isPipe(path)){this.token=randomUUID();await writeFile(accountPaths().stateDir+'/control-token',this.token,{mode:0o600})}else await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e})
  this.server=http.createServer(async(req,res)=>{
   try{
    if(this.token&&req.headers['x-control-token']!==this.token)throw Object.assign(Error('Unauthorized'),{statusCode:403})
    let result
    if(req.method==='GET'&&req.url==='/status')result=this.status()
    else if(req.method==='POST'&&req.url==='/remote-text'){let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Object.assign(Error('Too large'),{statusCode:413})}result=await this.onRemoteText(JSON.parse(body))}
    else if(req.method==='POST'&&['/drain','/seal','/resume'].includes(req.url)){
     let body='';for await(const chunk of req){body+=chunk;if(body.length>512)throw Object.assign(Error('Too large'),{statusCode:413})}
     result=this.command(req.url.slice(1),JSON.parse(body).lease)
    }else throw Object.assign(Error('Not found'),{statusCode:404})
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))
   }catch(error){res.writeHead(error.statusCode??400,{'content-type':'application/json'});res.end(JSON.stringify({error:'CONTROL_REQUEST_REJECTED'}))}
  })
  this.server.requestTimeout=3000;this.server.headersTimeout=3000
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(path,resolve)})
  if(!isPipe(path))await chmod(path,0o600)
 }
 async close(){if(this.server)await new Promise(resolve=>this.server.close(resolve));if(this.path&&!isPipe(this.path))await unlink(this.path).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
async function tokenFile(socket){for(const p of await listAccounts())if(p.socket===socket)return p.stateDir+'/control-token';throw Error('UNKNOWN_CONTROL_ENDPOINT')}
export async function controlRequest(socketPath,method,path,body,timeoutMs=2500){
 const headers=isPipe(socketPath)?{'x-control-token':await readFile(await tokenFile(socketPath),'utf8')}:{}
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,method,path,headers,timeout:timeoutMs},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;if(text.length>16384)res.destroy(Error('Oversized control response'))});res.on('error',reject)
   res.on('end',()=>{if(res.statusCode!==200){reject(Object.assign(Error('Control request rejected'),{code:'CONTROL_REJECTED',statusCode:res.statusCode}));return}try{resolve(JSON.parse(text))}catch(error){reject(error)}})
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Object.assign(Error('Control timeout'),{code:'ETIMEDOUT'})));req.end(body?JSON.stringify(body):undefined)
 })
}
