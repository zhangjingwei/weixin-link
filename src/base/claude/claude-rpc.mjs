import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {writeFile,unlink,mkdir} from 'node:fs/promises'
import {join} from 'node:path'

const definitive=message=>Object.assign(Error(message),{definitiveRpcError:true})
const textInput=input=>{
 if(!Array.isArray(input))throw definitive('CLAUDE_INPUT_INVALID')
 return input.map(item=>{
  if(item.type==='text')return item.text
  if(item.type==='localImage')return `用户图片文件：${item.path}。请按需读取。`
  if(item.type==='localAudio')return `用户音频文件：${item.path}。请按需读取；不能读取时如实说明。`
  throw definitive('CLAUDE_INPUT_UNSUPPORTED')
 }).join('\n\n')
}

/** Maps Claude's documented stream-json CLI output into the shared turn events. */
export class ClaudeRpc{
 constructor({cwd,binary,stateDir=cwd,onEvent=()=>{},onClose=()=>{},log=()=>{},spawnProcess=spawn,env=process.env}){
  this.cwd=cwd;this.binary=binary;this.stateDir=stateDir;this.onEvent=onEvent;this.onClose=onClose;this.log=log;this.spawnProcess=spawnProcess;this.env=env
  this.closed=false;this.threads=new Set();this.active=null
 }
 write(){}
 respond(){}
 close(){if(this.closed)return;this.closed=true;this.active?.child.kill('SIGINT');this.onClose()}
 async request(method,params={}){
  if(this.closed)throw definitive('CLAUDE_CONNECTION_CLOSED')
  if(method==='initialize'||method==='thread/memoryMode/set')return {}
  if(method==='thread/start'){const id=randomUUID();this.threads.add(id);this.instructions=params.developerInstructions;return {thread:{id},model:null,modelProvider:'anthropic'}}
  if(method==='thread/resume'){if(!params.threadId||!/^[a-f\d-]{36}$/i.test(params.threadId))throw definitive('CLAUDE_SESSION_ID_INVALID');this.threads.add(params.threadId);this.started??=new Set();this.started.add(params.threadId);this.instructions=params.developerInstructions;return {thread:{id:params.threadId},model:null,modelProvider:'anthropic'}}
  if(method==='thread/read'){if(!this.threads.has(params.threadId))throw definitive('CLAUDE_SESSION_UNKNOWN');return {thread:{id:params.threadId,cwd:this.cwd,status:{type:this.active?.threadId===params.threadId?'active':'idle'}}}}
  if(method==='turn/start')return this.startTurn(params)
  if(method==='turn/interrupt')return this.interrupt(params)
  if(method==='turn/steer')throw definitive('CLAUDE_TURN_STEER_UNSUPPORTED')
  throw definitive('CLAUDE_METHOD_UNSUPPORTED: '+method)
 }
 async startTurn({threadId,input}){
  if(!this.threads.has(threadId))throw definitive('CLAUDE_SESSION_UNKNOWN')
  if(this.active)throw definitive('CLAUDE_TURN_ALREADY_RUNNING')
  if(!this.env.ANTHROPIC_API_KEY&&!this.env.CLAUDE_CODE_USE_BEDROCK&&!this.env.CLAUDE_CODE_USE_VERTEX&&!this.env.CLAUDE_CODE_USE_FOUNDRY)throw definitive('CLAUDE_API_CREDENTIALS_REQUIRED')
  const turnId=randomUUID(),prompt=textInput(input)
  if(Buffer.byteLength(prompt)>9*1024*1024)throw definitive('CLAUDE_INPUT_LIMIT')
  let instructionPath
  await mkdir(this.stateDir,{recursive:true,mode:0o700})
  if(this.env.CLAUDE_CONFIG_DIR)await mkdir(this.env.CLAUDE_CONFIG_DIR,{recursive:true,mode:0o700})
  if(this.instructions){instructionPath=join(this.stateDir,'claude-instructions-'+randomUUID()+'.txt');await writeFile(instructionPath,this.instructions,{mode:0o600,flag:'wx'})}
  const args=['--bare','-p','--output-format','stream-json','--verbose','--permission-mode','bypassPermissions','--permission-prompts','none',...(instructionPath?['--append-system-prompt-file',instructionPath]:[]),...(this.started?.has(threadId)?['--resume',threadId]:['--session-id',threadId]),'请处理标准输入中的用户请求。']
  // One process per turn keeps the official Claude transcript authoritative.
  let child
  try{child=this.spawnProcess(this.binary,args,{cwd:this.cwd,env:{...this.env,WECHAT_CONVERSATION_ID:threadId},stdio:['pipe','pipe','pipe']})}catch(error){if(instructionPath)await unlink(instructionPath);throw definitive('CLAUDE_START_FAILED: '+error.code)}
  const active={child,threadId,turnId,instructionPath,buffer:'',bytes:0,stderr:'',result:null,started:false,interrupted:false,completed:false}
  this.active=active
  child.stdin.on('error',()=>{active.stdinFailed=true;this.abort(active,Error('CLAUDE_INPUT_FAILED'))})
  child.stdout.on('data',chunk=>this.consume(active,chunk))
  child.stderr.on('data',chunk=>{active.stderr=(active.stderr+chunk.toString()).slice(-2048)})
  child.on('error',error=>this.finish(active,null,error))
  child.on('close',code=>this.finish(active,code))
  child.stdin.end(prompt)
  return {turn:{id:turnId}}
 }
 abort(active,error){
  if(this.active!==active||active.completed)return
  if(active.failure)return
  active.failure=error
  active.child.kill('SIGINT')
  const timer=setTimeout(()=>{if(!active.completed)active.child.kill('SIGKILL')},5000)
  timer.unref()
 }
 consume(active,chunk){
  if(this.active!==active)return
  active.bytes+=chunk.length
  if(active.bytes>32*1024*1024){this.abort(active,Error('CLAUDE_OUTPUT_LIMIT'));return}
  active.buffer+=chunk.toString()
  if(active.buffer.length>1024*1024){this.abort(active,Error('CLAUDE_OUTPUT_LINE_LIMIT'));return}
  let index
  while((index=active.buffer.indexOf('\n'))>=0){const line=active.buffer.slice(0,index);active.buffer=active.buffer.slice(index+1);if(!line.trim())continue;let event;try{event=JSON.parse(line)}catch{this.log('claude.output_invalid',{kind:'json'});continue}this.event(active,event)}
 }
 event(active,event){
  if(this.active!==active)return
  if(event.session_id&&event.session_id!==active.threadId){this.abort(active,Error('CLAUDE_SESSION_ID_MISMATCH'));return}
  if(event.type==='system'&&event.subtype==='init'){
   active.started=true;this.started??=new Set();this.started.add(active.threadId)
   void this.onEvent({method:'turn/started',params:{threadId:active.threadId,turn:{id:active.turnId}}})
  }
  if(event.type==='result')active.result=event
 }
 finish(active,code,error){
  if(this.active!==active||active.completed)return
  if(active.buffer.trim()){try{this.event(active,JSON.parse(active.buffer))}catch{}}
  active.completed=true;this.active=null
  if(active.instructionPath)void unlink(active.instructionPath).catch(()=>{})
  let status='failed',message
  if(active.interrupted)status='interrupted'
  else if(!error&&!active.failure&&code===0&&active.result&&!active.result.is_error&&active.result.subtype==='success')status='completed'
  else message=active.failure?.message??error?.message??(active.result?.subtype||'CLAUDE_PROCESS_FAILED')
  if(status==='completed'&&typeof active.result.result==='string')void this.onEvent({method:'item/completed',params:{threadId:active.threadId,turnId:active.turnId,item:{id:randomUUID(),type:'agentMessage',phase:'final_answer',text:active.result.result}}})
  void this.onEvent({method:'turn/completed',params:{threadId:active.threadId,turn:{id:active.turnId,status,...(message?{error:{message}}:{})}}})
 }
 async interrupt({threadId,turnId}){
  const active=this.active
  if(!active||active.threadId!==threadId||active.turnId!==turnId)throw definitive('no active turn to interrupt')
  active.interrupted=true
  active.child.kill('SIGINT')
  await new Promise((resolve,reject)=>{if(active.completed)return resolve();const timer=setTimeout(()=>reject(Error('CLAUDE_STOP_UNCONFIRMED')),5000);active.child.once('close',()=>{clearTimeout(timer);resolve()})})
  return {stopped:true}
 }
}
