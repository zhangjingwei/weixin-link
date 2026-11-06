import {setTimeout as delay} from 'node:timers/promises'
export const isTransientConnectionError=error=>new Set(['REMOTE_DISCONNECTED','REMOTE_CONNECT_TIMEOUT','REMOTE_CONNECT_FAILED','REMOTE_REQUEST_UNCERTAIN']).has(error.message)
// Connection lifecycle only. Codex initialization/recovery is supplied by the coordinator.
export class ReconnectingConnection {
 constructor({transportFactory,createSession,prepareSession=async()=>{},onDisconnected=()=>{},retryDelays=[250,1000,2500]}){
  Object.assign(this,{transportFactory,createSession,prepareSession,onDisconnected,retryDelays});this.closed=false;this.transport=null;this.session=null;this.connecting=null;this.reconnects=0;this.abort=new AbortController()
 }
 async connect(){
  if(this.closed)throw Error('REMOTE_CLOSED')
  if(this.connecting)return this.connecting
  if(this.transport&&!this.transport.closed)return this.session
  const attempt=async()=>{let last
   for(let n=0;n<=this.retryDelays.length;n++){
    if(this.closed)throw Error('REMOTE_CLOSED')
    if(n)await delay(this.retryDelays[n-1],undefined,{signal:this.abort.signal})
    let transport,session
    try{
     transport=this.transportFactory({onDisconnect:()=>{
      if(this.closed||this.transport!==transport)return
      this.onDisconnected(session)
      queueMicrotask(()=>{if(!this.closed&&!this.connecting)void this.connect().catch(()=>{})})
     }})
     this.transport=transport;session=this.createSession(transport);this.session=session
     await transport.connect();if(this.closed)throw Error('REMOTE_CLOSED')
     await this.prepareSession(session,transport)
     if(this.closed)throw Error('REMOTE_CLOSED')
     if(transport.closed)throw Error('REMOTE_DISCONNECTED')
     if(this.everConnected)this.reconnects++;this.everConnected=true;return session
    }catch(error){last=error;if(this.transport===transport){this.transport=null;this.session=null}this.onDisconnected(session);transport?.close();if(!isTransientConnectionError(error))throw error}
   }
   throw Object.assign(Error('REMOTE_RECONNECT_EXHAUSTED'),{cause:last})
  }
  this.connecting=attempt();try{return await this.connecting}finally{this.connecting=null}
 }
 invalidate(){const transport=this.transport,session=this.session;this.transport=null;this.session=null;this.onDisconnected(session);transport?.close()}
 close(){if(this.closed)return;this.closed=true;this.abort.abort();this.invalidate()}
}
