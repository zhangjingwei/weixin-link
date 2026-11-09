// Shared Codex JSON-RPC protocol. Transports only send/receive messages.
export const localRpcErrors={
 disconnected:method=>Object.assign(Error('Codex 连接已断开。'),{connectionClosed:true,method}),
 timeout:method=>Object.assign(Error(`Codex ${method} 响应超时。`),{requestTimeout:true,method}),
 response:(error,method)=>Object.assign(Error(error.message??'Codex 请求失败。'),{definitiveRpcError:true,rpcCode:error.code,method}),
}
export const remoteRpcErrors={
 disconnected:method=>Object.assign(Error('REMOTE_DISCONNECTED'),{method}),
 timeout:method=>Object.assign(Error('REMOTE_REQUEST_UNCERTAIN'),{method}),
 response:(error,method)=>Object.assign(Error('REMOTE_RPC_ERROR'),{rpcCode:error.code,method}),
}
export class CodexProtocolClient {
 constructor({transport,onEvent=()=>{},onClose=()=>{},log=()=>{},errors=localRpcErrors,timeout=45000,errorFields=()=>({error_type:'Error'})}){
  if(typeof transport?.send!=='function'||typeof transport?.close!=='function')throw Error('INVALID_CODEX_TRANSPORT')
  Object.assign(this,{transport,onEvent,onClose,log,errors,timeout,errorFields});this.nextId=0;this.pending=new Map();this.closed=false
  transport.onMessage=message=>this.accept(message)
 }
 get child(){return this.transport.child}
 accept(message){
  if(this.closed)return
  if(message.id!==undefined&&!message.method){
   const request=this.pending.get(message.id)
   if(!request){this.log('rpc.unmatched_response',{rpc_id:message.id});return}
   this.pending.delete(message.id);clearTimeout(request.timer)
   this.log('rpc.response',{rpc_id:message.id,method:request.method,status:message.error?'error':'ok',code:message.error?.code,duration_ms:Date.now()-request.started})
   message.error?request.reject(this.errors.response(message.error,request.method)):request.resolve(message.result)
  }else{try{Promise.resolve(this.onEvent(message)).catch(error=>this.log('rpc.event_failed',this.errorFields(error)))}catch(error){this.log('rpc.event_failed',this.errorFields(error))}}
 }
 write(message){if(this.closed)throw this.errors.disconnected();this.transport.send(message)}
 request(method,params={},timeout=this.timeout){
  return new Promise((resolve,reject)=>{
   const id=++this.nextId,started=Date.now();this.log('rpc.request',{rpc_id:id,method})
   const timer=setTimeout(()=>{this.pending.delete(id);this.log('rpc.timeout',{rpc_id:id,method,duration_ms:Date.now()-started});reject(this.errors.timeout(method))},timeout)
   this.pending.set(id,{resolve,reject,timer,method,started})
   try{this.write({id,method,params})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error instanceof Error?error:this.errors.disconnected(method))}
  })
 }
 call(method,params={},timeout=this.timeout){return this.request(method,params,timeout)}
 respond(id,result){this.write({id,result})}
 respondError(id,error){this.write({id,error})}
 disconnect(){
  if(this.closed)return;this.closed=true
  for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(this.errors.disconnected(request.method))}
  this.pending.clear();this.onClose()
 }
 close(){this.transport.close()}
}
