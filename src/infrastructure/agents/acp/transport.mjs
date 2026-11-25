import {spawn} from 'node:child_process'
// Private bounded stdio JSON-RPC transport. Never log untrusted payloads/stderr.
export class AcpTransport {
 constructor({binary,args=[],env,cwd,onNotification=()=>{},onRequest=()=>{},onClose=()=>{},spawnProcess=spawn,timeout=30000,errorPrefix='WORKBUDDY'}){
  Object.assign(this,{onNotification,onRequest,onClose,timeout,errorPrefix});this.calls=new Map();this.sequence=0;this.closed=false;this.buffer=''
  this.child=spawnProcess(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true})
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>this.consume(chunk))
  this.child.stderr.on('data',()=>{})
  this.child.on('error',()=>this.close());this.child.on('exit',()=>this.close());this.child.stdout.on('end',()=>this.close());this.child.stdin.on('error',()=>this.close())
 }
 consume(chunk){
  if(this.closed)return
  this.buffer+=chunk
  if(Buffer.byteLength(this.buffer)>32*1024*1024){this.close();return}
  let index
  while((index=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1)
   if(!line.trim())continue
   let message
   try{message=JSON.parse(line);if(message.jsonrpc!=='2.0')throw Error()}catch{this.close();return}
   if(typeof message.method==='string'){
    if(message.id!==undefined)void Promise.resolve().then(()=>this.onRequest(message)).catch(()=>this.respond(message.id,{outcome:{outcome:'cancelled'}}))
    else void Promise.resolve().then(()=>this.onNotification(message)).catch(()=>this.close())
   }else{
    const pending=this.calls.get(message.id);if(!pending)continue
    this.calls.delete(message.id);clearTimeout(pending.timer)
    if(message.error)pending.reject(Object.assign(Error(message.error.code===-32000?`${this.errorPrefix}_LOGIN_REQUIRED`:`${this.errorPrefix}_RPC_REJECTED`),{code:message.error.code===-32000?`${this.errorPrefix}_LOGIN_REQUIRED`:`${this.errorPrefix}_RPC_REJECTED`}))
    else if(Object.hasOwn(message,'result'))pending.resolve(message.result)
    else{pending.reject(Error(`${this.errorPrefix}_INVALID_RESPONSE`));this.close()}
   }
  }
 }
 write(message){if(this.closed)throw Error(`${this.errorPrefix}_CONNECTION_CLOSED`);this.child.stdin.write(JSON.stringify(message)+'\n')}
 call(method,params,{timeout=this.timeout}={}){
  if(this.closed||this.calls.size>=32)return Promise.reject(Error(`${this.errorPrefix}_CONNECTION_UNAVAILABLE`))
  const id=++this.sequence
  return new Promise((resolve,reject)=>{
   const timer=timeout?setTimeout(()=>{this.close()},timeout):null
   timer?.unref?.();this.calls.set(id,{resolve,reject,timer})
   try{this.write({jsonrpc:'2.0',id,method,params})}catch{this.close()}
  })
 }
 notify(method,params){this.write({jsonrpc:'2.0',method,params})}
 respond(id,result){if(!this.closed)this.write({jsonrpc:'2.0',id,result})}
 reject(id){if(!this.closed)this.write({jsonrpc:'2.0',id,error:{code:-32601,message:'Unsupported client method'}})}
 close(){
  if(this.closed)return;this.closed=true
  for(const p of this.calls.values()){clearTimeout(p.timer);p.reject(Error(`${this.errorPrefix}_CONNECTION_LOST`))}this.calls.clear()
  this.child.kill();this.onClose()
 }
}
