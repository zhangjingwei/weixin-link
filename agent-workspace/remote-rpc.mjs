import {spawn} from 'node:child_process'
import net from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {join} from 'node:path'
import {HOSTS,sshConfig,shellQuote} from './remote-config.mjs'
export {HOSTS} from './remote-config.mjs'
export class RemoteTransport {
 constructor(host,{onEvent=()=>{},onDisconnect=()=>{}}={}){if(!HOSTS[host])throw Error('UNKNOWN_HOST');Object.assign(this,{host,onEvent,onDisconnect});this.pending=new Map();this.nextId=0;this.closed=false;this.opened=false}
 async connect(){
  try{
   if(HOSTS[this.host].transport==='ssh-websocket'){
    const reservation=net.createServer();await new Promise((ok,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',ok)});const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));
    this.child=spawn('ssh',['-F',sshConfig,'-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ClearAllForwardings=no','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','TCPKeepAlive=yes','-L',`127.0.0.1:${port}:127.0.0.1:${HOSTS[this.host].port}`,this.host],{stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',()=>{});this.child.stderr.on('data',()=>{});this.child.on('error',()=>this.close());this.child.on('close',()=>this.close());
    await new Promise((ok,fail)=>{let attempts=0;const check=()=>{if(this.closed)return fail(Error('REMOTE_CONNECT_FAILED'));const probe=net.connect(port,'127.0.0.1');probe.once('connect',()=>{probe.destroy();ok()});probe.once('error',()=>{probe.destroy();if(++attempts>=50)fail(Error('REMOTE_CONNECT_TIMEOUT'));else setTimeout(check,100)})};check()});
    this.ws=new WebSocket('ws://127.0.0.1:'+port)
   }else{
   this.server=net.createServer(socket=>{
    this.socket=socket;this.server.close()
    this.child=spawn('ssh',['-F',sshConfig,'-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','TCPKeepAlive=yes',this.host,'exec '+shellQuote(HOSTS[this.host].binary)+' app-server proxy'],{stdio:['pipe','pipe','pipe']})
    this.child.stdin.on('error',()=>{});this.child.stdout.pipe(socket);socket.pipe(this.child.stdin);socket.on('error',()=>{});this.child.stderr.on('data',()=>{})
    this.child.on('error',()=>this.close());this.child.on('close',()=>this.close());socket.on('close',()=>this.close())
   });this.server.maxConnections=1
   await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve)})
   this.ws=new WebSocket('ws://127.0.0.1:'+this.server.address().port)
   }
   this.ws.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>72*1024*1024){this.close();return}
    let message;try{message=JSON.parse(event.data)}catch{this.close();return}
    if(message.id!==undefined&&!message.method){const request=this.pending.get(message.id);if(!request)return;clearTimeout(request.timer);this.pending.delete(message.id);message.error?request.reject(Object.assign(Error('REMOTE_RPC_ERROR'),{rpcCode:message.error.code,method:request.method})):request.resolve(message.result)}
    else if(message.id!==undefined&&message.method){
     // No blanket approvals: the coordinator must not silently grant an unknown remote request.
     this.write({id:message.id,error:{code:-32601,message:'Use a native Codex client for this interaction'}})
    }else{try{this.onEvent(message)}catch{}}
   });this.ws.addEventListener('close',()=>this.close());this.ws.addEventListener('error',()=>this.close())
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('REMOTE_CONNECT_TIMEOUT')),10000);this.ws.addEventListener('open',()=>{clearTimeout(timer);this.opened=true;resolve()},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('REMOTE_CONNECT_FAILED'))},{once:true})})
   await this.call('initialize',{clientInfo:{name:'wechat_remote_adapter',title:'WeChat remote adapter',version:'1.0'},capabilities:{experimentalApi:true}});this.write({method:'initialized',params:{}});return this
  }catch(error){this.close();throw error}
 }
 write(message){if(this.closed||!this.opened)throw Error('REMOTE_DISCONNECTED');this.ws.send(JSON.stringify(message))}
 call(method,params={},timeout=30000){return new Promise((resolve,reject)=>{const id=++this.nextId,timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(Error('REMOTE_REQUEST_UNCERTAIN'),{method}))},timeout);this.pending.set(id,{resolve,reject,timer,method});try{this.write({id,method,params})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}})}
 close(){if(this.closed)return;this.closed=true;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('REMOTE_DISCONNECTED'))}this.pending.clear();try{this.ws?.close()}catch{}this.socket?.destroy();this.server?.close();this.child?.kill();this.onDisconnect()}
}

// Transport recovery never replays a mutating RPC: its server-side outcome may be unknown.
const READ_ONLY=new Set(['thread/read','thread/list','thread/turns/list','thread/backgroundTerminals/list','fs/getMetadata','fs/readFile'])
const TRANSIENT=new Set(['REMOTE_DISCONNECTED','REMOTE_CONNECT_TIMEOUT','REMOTE_CONNECT_FAILED','REMOTE_REQUEST_UNCERTAIN'])
export class RemoteRpc {
 constructor(host,{onEvent=()=>{},transportFactory=(h,o)=>new RemoteTransport(h,o),retryDelays=[250,1000,2500]}={}){
  if(!HOSTS[host])throw Error('UNKNOWN_HOST')
  Object.assign(this,{host,onEvent,transportFactory,retryDelays});this.closed=false;this.transport=null;this.connecting=null;this.recovery=null;this.reconnects=0;this.abort=new AbortController()
 }
 get child(){return this.transport?.child}
 setRecovery({taskId,threadId,cwd}){this.recovery={taskId,threadId,cwd}}
 async connect(){
  if(this.closed)throw Error('REMOTE_CLOSED')
  if(this.connecting)return this.connecting
  if(this.transport&&!this.transport.closed)return this
  const attempt=async()=>{let last
   for(let n=0;n<=this.retryDelays.length;n++){
    if(this.closed)throw Error('REMOTE_CLOSED')
    if(n)await delay(this.retryDelays[n-1],undefined,{signal:this.abort.signal})
    let transport
    try{
     transport=this.transportFactory(this.host,{onEvent:event=>{if(!this.closed&&this.transport===transport)this.onEvent(event)},onDisconnect:()=>{
      if(this.closed||this.transport!==transport)return
      // Recover idle connections too, but stop after the bounded retry budget.
      queueMicrotask(()=>{if(!this.closed&&!this.connecting)void this.connect().catch(()=>{})})
     }})
     this.transport=transport;await transport.connect()
     if(this.closed)throw Error('REMOTE_CLOSED')
     if(this.recovery?.threadId){const result=await transport.call('thread/resume',{threadId:this.recovery.threadId,excludeTurns:true});if(result.thread.id!==this.recovery.threadId||this.recovery.cwd&&result.thread.cwd!==this.recovery.cwd)throw Error('RECOVERY_THREAD_MISMATCH')}
     if(this.everConnected)this.reconnects++;this.everConnected=true;return this
    }catch(error){last=error;if(this.transport===transport)this.transport=null;transport?.close();if(!TRANSIENT.has(error.message))throw error}
   }
   throw Object.assign(Error('REMOTE_RECONNECT_EXHAUSTED'),{cause:last})
  }
  this.connecting=attempt();try{return await this.connecting}finally{this.connecting=null}
 }
 async call(method,params={},timeout=30000){
  await this.connect()
  const transport=this.transport
  try{return await transport.call(method,params,timeout)}catch(error){
   if(this.closed||!TRANSIENT.has(error.message))throw error
   // A timed-out read is safe to reissue after reattaching. Never infer mutation failure.
   if(this.transport===transport)this.transport=null;transport.close()
   if(!READ_ONLY.has(method)){void this.connect().catch(()=>{});throw Object.assign(Error('REMOTE_REQUEST_UNCERTAIN'),{method})}
   await this.connect();return this.transport.call(method,params,timeout)
  }
 }
 close(){if(this.closed)return;this.closed=true;this.abort.abort();this.transport?.close();this.transport=null}
}
