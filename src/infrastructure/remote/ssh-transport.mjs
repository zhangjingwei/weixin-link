import {spawn} from 'node:child_process'
import net from 'node:net'
import {HOSTS,sshConfig,shellQuote,configuredHost,validateHostConfig} from './host-config.mjs'
export {HOSTS} from './host-config.mjs'
export class RemoteTransport {
 constructor(host,{onMessage=()=>{},onDisconnect=()=>{},config}={}){const hostConfig=config??configuredHost(host);validateHostConfig(host,hostConfig);Object.assign(this,{host,config:structuredClone(hostConfig),onMessage,onDisconnect});this.closed=false;this.opened=false}
 async connect(){
  try{
   if(this.config.transport==='ssh-websocket'){
    const reservation=net.createServer();await new Promise((ok,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',ok)});const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));
    this.child=spawn('ssh',['-F',sshConfig,'-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ClearAllForwardings=no','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','TCPKeepAlive=yes','-L',`127.0.0.1:${port}:127.0.0.1:${this.config.port}`,this.host],{stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',()=>{});this.child.stderr.on('data',()=>{});this.child.on('error',()=>this.close());this.child.on('close',()=>this.close());
    await new Promise((ok,fail)=>{let attempts=0;const check=()=>{if(this.closed)return fail(Error('REMOTE_CONNECT_FAILED'));const probe=net.connect(port,'127.0.0.1');probe.once('connect',()=>{probe.destroy();ok()});probe.once('error',()=>{probe.destroy();if(++attempts>=50)fail(Error('REMOTE_CONNECT_TIMEOUT'));else setTimeout(check,100)})};check()});
    this.ws=new WebSocket('ws://127.0.0.1:'+port)
   }else{
   this.server=net.createServer(socket=>{
    this.socket=socket;this.server.close()
    this.child=spawn('ssh',['-F',sshConfig,'-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','TCPKeepAlive=yes',this.host,'exec '+shellQuote(this.config.binary)+' app-server proxy'],{stdio:['pipe','pipe','pipe']})
    this.child.stdin.on('error',()=>{});this.child.stdout.pipe(socket);socket.pipe(this.child.stdin);socket.on('error',()=>{});this.child.stderr.on('data',()=>{})
    this.child.on('error',()=>this.close());this.child.on('close',()=>this.close());socket.on('close',()=>this.close())
   });this.server.maxConnections=1
   await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve)})
   this.ws=new WebSocket('ws://127.0.0.1:'+this.server.address().port)
   }
   this.ws.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>72*1024*1024){this.close();return}
    let message;try{message=JSON.parse(event.data)}catch{this.close();return}
    this.onMessage(message)
   });this.ws.addEventListener('close',()=>this.close());this.ws.addEventListener('error',()=>this.close())
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('REMOTE_CONNECT_TIMEOUT')),10000);this.ws.addEventListener('open',()=>{clearTimeout(timer);this.opened=true;resolve()},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('REMOTE_CONNECT_FAILED'))},{once:true})})
   return this
  }catch(error){this.close();throw error}
 }
 send(message){if(this.closed||!this.opened)throw Error('REMOTE_DISCONNECTED');this.ws.send(JSON.stringify(message))}
 close(){if(this.closed)return;this.closed=true;try{this.ws?.close()}catch{}this.socket?.destroy();this.server?.close();this.child?.kill();this.onDisconnect()}
}
