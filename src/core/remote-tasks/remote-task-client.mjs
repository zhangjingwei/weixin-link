import {CodexProtocolClient,remoteRpcErrors} from '../../base/codex/protocol-client.mjs'
import {initializeCodex,isReadOnlyCodexMethod} from '../../base/codex/protocol-operations.mjs'
import {RemoteTransport} from '../../remote/ssh-transport.mjs'
import {ReconnectingConnection,isTransientConnectionError} from '../../remote/reconnecting-connection.mjs'
import {HOSTS} from '../../remote/remote-config.mjs'
// Codex session recovery and replay policy are coordination, never SSH transport behavior.
export class RemoteRpc {
 constructor(host,{onEvent=()=>{},transportFactory=(h,o)=>new RemoteTransport(h,o),retryDelays=[250,1000,2500]}={}){
  if(!HOSTS[host])throw Error('UNKNOWN_HOST')
  Object.assign(this,{host,onEvent});this.recovery=null
  this.connection=new ReconnectingConnection({retryDelays,
   transportFactory:options=>transportFactory(host,{...options,onEvent:event=>this.onEvent(event)}),
   createSession:transport=>{
    const client=new CodexProtocolClient({transport,errors:remoteRpcErrors,timeout:30000,onEvent:message=>{
     if(message.id!==undefined&&message.method){client.respondError(message.id,{code:-32601,message:'Use a native Codex client for this interaction'});return}
     return this.onEvent(message)
    }})
    return client
   },
   prepareSession:async client=>{
    await initializeCodex(client,{name:'wechat_remote_adapter',title:'WeChat remote adapter',version:'1.0'})
    if(this.recovery?.threadId){const result=await client.call('thread/resume',{threadId:this.recovery.threadId,excludeTurns:true});if(result.thread.id!==this.recovery.threadId||this.recovery.cwd&&result.thread.cwd!==this.recovery.cwd)throw Error('RECOVERY_THREAD_MISMATCH')}
   },
   onDisconnected:client=>client?.disconnect?.(),
  })
 }
 get child(){return this.connection.transport?.child}
 get transport(){return this.connection.transport}
 get client(){return this.connection.session}
 get closed(){return this.connection.closed}
 get reconnects(){return this.connection.reconnects}
 setRecovery({taskId,threadId,cwd}){this.recovery={taskId,threadId,cwd}}
 async connect(){await this.connection.connect();return this}
 async request(method,params={},timeout=30000){
  const client=await this.connection.connect(),transport=this.transport
  try{return await client.call(method,params,timeout)}catch(error){
   if(this.closed||!isTransientConnectionError(error))throw error
   if(this.transport===transport)this.connection.invalidate()
   // Server acceptance is unknown for writes; reconnect but never replay them.
   if(!isReadOnlyCodexMethod(method)){void this.connect().catch(()=>{});throw Object.assign(Error('REMOTE_REQUEST_UNCERTAIN'),{method})}
   const recovered=await this.connection.connect();return recovered.call(method,params,timeout)
  }
 }
 call(method,params={},timeout=30000){return this.request(method,params,timeout)}
 close(){this.connection.close()}
}
