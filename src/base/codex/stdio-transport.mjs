import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {errorFields} from '../../core/diagnostics/diagnostic-log.mjs'
export class StdioTransport {
 constructor({binary,args,cwd,env,log=()=>{}}){
  this.log=log;this.closed=false;this.onMessage=()=>{};this.onClose=()=>{}
  this.child=spawn(binary,args,{cwd,env});this.child.stdin.on('error',()=>{})
  this.child.stderr.on('data',chunk=>{this.stderrBytes=(this.stderrBytes??0)+chunk.length})
  log('rpc.spawn',{pid:this.child.pid})
  this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{
   let message;try{message=JSON.parse(line)}catch{log('rpc.invalid_json');return}this.onMessage(message)
  })
  const ended=(code,signal)=>{
   log('rpc.closed',{exit_code:typeof code==='number'?code:undefined,signal,bytes:this.stderrBytes??0})
   if(this.closed)return;this.closed=true;this.onClose()
  }
  this.child.on('error',error=>{log('rpc.spawn_failed',errorFields(error));ended()});this.child.on('close',ended)
 }
 send(message){if(this.closed)throw Object.assign(Error('Codex 连接已关闭。'),{connectionClosed:true});this.child.stdin.write(JSON.stringify(message)+'\n')}
 close(){this.child.kill()}
}
