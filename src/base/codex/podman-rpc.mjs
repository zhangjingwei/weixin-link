import {spawn} from 'node:child_process'
import net from 'node:net'
const failure=(message,fields={})=>Object.assign(Error(message),fields)
/** Official app-server WebSocket frames bridged through its Unix proxy. No task engine. */
export class PodmanRpc {
 constructor({backend,onEvent=()=>{},onClose=()=>{},log=()=>{}}){
  Object.assign(this,{backend,onEvent,onClose,log});this.nextId=0;this.pending=new Map();this.closed=false
  this.ready=this.connect();void this.ready.catch(()=>{})
 }
 async connect(){
  this.server=net.createServer(socket=>{
   this.socket=socket;this.server.close()
   this.child=spawn('podman',['exec','-i',this.backend.container,this.backend.binary,'app-server','proxy','--sock',this.backend.socket],{stdio:['pipe','pipe','pipe']})
   this.child.stdin.on('error',()=>{});this.child.stderr.on('data',()=>{});socket.on('error',()=>{})
   socket.pipe(this.child.stdin);this.child.stdout.pipe(socket)
   this.child.on('error',()=>this.disconnect());this.child.on('close',()=>this.disconnect())
  });this.server.maxConnections=1
  await new Promise((ok,fail)=>{this.server.once('error',fail);this.server.listen(0,'127.0.0.1',ok)})
  if(this.closed){this.server.close();throw failure('Codex container connection cancelled',{connectionClosed:true})}
  this.ws=new WebSocket('ws://127.0.0.1:'+this.server.address().port)
  this.ws.addEventListener('message',event=>{
   let message;try{message=JSON.parse(event.data)}catch{this.disconnect();return}
   if(message.id!==undefined&&!message.method){const p=this.pending.get(message.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(failure(message.error.message??'Codex container RPC rejected',{definitiveRpcError:true,rpcCode:message.error.code,method:p.method})):p.resolve(message.result)}
   else Promise.resolve(this.onEvent(message)).catch(()=>this.log('rpc.event_failed',{code:'CONTAINER_EVENT_FAILED'}))
  })
  this.ws.addEventListener('close',()=>this.disconnect());this.ws.addEventListener('error',()=>this.disconnect())
  await new Promise((ok,fail)=>{const timer=setTimeout(()=>{this.disconnect();fail(failure('Codex container connection timeout',{connectionClosed:true}))},15000);this.ws.addEventListener('open',()=>{clearTimeout(timer);ok()},{once:true});this.ws.addEventListener('close',()=>{clearTimeout(timer);fail(failure('Codex container disconnected',{connectionClosed:true}))},{once:true})})
 }
 async request(method,params,timeout=45000){
  await this.ready
  if(method==='initialize')params={...params,capabilities:{...params?.capabilities,experimentalApi:true}}
  return new Promise((resolve,reject)=>{const id=++this.nextId;const timer=setTimeout(()=>{this.pending.delete(id);reject(failure('Codex '+method+' response timeout',{requestTimeout:true,method}))},timeout);this.pending.set(id,{resolve,reject,timer,method});try{this.write({id,method,params})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}})
 }
 write(message){if(this.closed||this.ws?.readyState!==WebSocket.OPEN)throw failure('Codex container connection closed',{connectionClosed:true});this.ws.send(JSON.stringify(message))}
 respond(id,result){this.write({id,result})}
 disconnect(notify=true){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(failure('Codex container disconnected',{connectionClosed:true,method:p.method}))}this.pending.clear();this.ws?.close();this.socket?.destroy();this.server?.close();this.child?.kill();if(notify)this.onClose()}
 close(){this.disconnect(false)}
}
