import {createHash,randomUUID} from 'node:crypto'
import {claudeEnvironment} from './environment.mjs'
import {claudeContent} from './input.mjs'

class InputStream {
 constructor(){this.buffer=[];this.done=false}
 push(value){if(this.done||this.buffer.length>=5)throw Error('CLAUDE_INPUT_CLOSED');this.buffer.push(value);this.wake?.()}
 close(){this.done=true;this.wake?.()}
 async *[Symbol.asyncIterator](){while(!this.done){if(this.buffer.length){yield this.buffer.shift();continue}await new Promise(resolve=>{this.wake=resolve})}}
}
// Compatibility events end at this adapter; no Codex request is sent to Claude.
export class ClaudeSession {
 constructor({query,binary,cwd,onEvent=()=>{},onClose=()=>{},env=process.env}){
  Object.assign(this,{query,binary,cwd,onEvent,onClose,env});this.closed=false;this.pending=new Map();this.seen=new Set();this.input=new InputStream();this.turn=null;this.phase='idle'
 }
 emit(method,params={},id){return Promise.resolve(this.onEvent({method,params:{threadId:this.id,...params},...(id?{id}:{})}))}
 async open(saved,instructions){
  if(saved.threadId&&saved.agentKind!=='claude')throw Error('CLAUDE_SESSION_PROVIDER_MISMATCH')
  const resuming=!!saved.threadId&&saved.hasMessages!==false
  this.id=resuming?saved.threadId:randomUUID();this.saved=saved
  saved.hasMessages??=false
  let timer
  try{this.handle=this.query({prompt:this.input,options:{pathToClaudeCodeExecutable:this.binary,cwd:this.cwd,env:{...claudeEnvironment(this.env),DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1'},
   ...(resuming?{resume:this.id}:{sessionId:this.id}),permissionMode:'default',permissionPrompts:'host',
   settingSources:['user','project'],disallowedTools:['Agent','Task','Monitor','CronCreate','ScheduleWakeup'],systemPrompt:{type:'preset',preset:'claude_code',append:instructions},
   includePartialMessages:true,canUseTool:(name,input,options)=>this.approve(name,input,options),stderr:()=>{}}})
  this.pumping=this.pump()
  const init=await Promise.race([this.handle.initializationResult(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CLAUDE_INITIALIZE_TIMEOUT')),15000)})]);if(this.closed)throw Error('CLAUDE_CLOSED');if(init.account&&(init.account.apiProvider&&init.account.apiProvider!=='firstParty'||init.account.apiKeySource&&!['none','oauth'].includes(init.account.apiKeySource)))throw Error('CLAUDE_AUTH_SOURCE_CHANGED');this.models=init.models??[];saved.agentKind='claude';return {thread:{id:this.id},model:this.models.find(m=>m.isDefault)?.value??'default',modelProvider:'claude'}}
  catch{this.close();throw Object.assign(Error('CLAUDE_INITIALIZATION_FAILED'),{code:'CLAUDE_INITIALIZATION_FAILED'})}finally{clearTimeout(timer)}
 }
 async start({threadId,input,deliveryId,model}){
  if(this.closed||threadId!==this.id||this.turn)throw Error('CLAUDE_SESSION_BUSY_OR_STALE')
  const content=await claudeContent(input)
  if(model&&model!=='default'){try{await this.handle.setModel(model)}catch{throw Error('CLAUDE_MODEL_CHANGE_FAILED')}}
  const hex=deliveryId?createHash('sha256').update('claude:'+deliveryId).digest('hex'):null
  const uuid=hex?`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`:randomUUID()
  this.turn={id:randomUUID(),uuid,texts:[],stopping:false};this.phase='active';this.observedAt=Date.now();const turn=this.turn
  // Publish start after the caller can persist its submission identity.
  this.input.push({type:'user',session_id:this.id,uuid:turn.uuid,message:{role:'user',content},parent_tool_use_id:null})
  queueMicrotask(()=>{void this.emit('turn/started',{turn:{id:turn.id}})})
  return {turn:{id:turn.id},deliveryId}
 }
 async pump(){
  try{for await(const m of this.handle){
   if(this.closed)break
   if(m.session_id&&m.session_id!==this.id)throw Error('CLAUDE_SESSION_ID_MISMATCH')
   const turn=this.turn;if(!turn)continue
   this.observedAt=Date.now()
   if(m.parent_tool_use_id)continue // Subagent prose is not the main answer.
   if(m.type==='system'&&m.subtype==='init'&&typeof m.model==='string'){await this.emit('model/rerouted',{turnId:turn.id,toModel:m.model})}
   else if(m.type==='assistant'){
    for(const [index,block] of (m.message?.content??[]).entries()){
     if(block.type==='text'&&typeof block.text==='string'){
      const key=(m.uuid??m.message.id)+':'+index;if(this.seen.has(key))continue;this.seen.add(key);if(block.text.length>1000000||turn.texts.join('').length+block.text.length>1000000)throw Error('CLAUDE_RESULT_TOO_LARGE');turn.texts.push(block.text)
     }else if(block.type==='tool_use'){
      if(this.seen.has(block.id))continue
      if(turn.texts.length){
       await this.emit('item/completed',{turnId:turn.id,item:{id:'progress:'+block.id,type:'agentMessage',phase:'commentary',text:turn.texts.join('\n\n')}})
       turn.texts=[]
      }
      this.seen.add(block.id)
      await this.emit('item/started',{turnId:turn.id,item:{id:block.id,type:'claudeTool',name:block.name}})
     }
    }
   }else if(m.type==='stream_event'){
    await this.emit('agent/activity',{turnId:turn.id}) // Activity only; never expose partial content.
   }else if(m.type==='user'){
    for(const block of m.message?.content??[])if(block.type==='tool_result')await this.emit('item/completed',{turnId:turn.id,item:{id:block.tool_use_id,type:'claudeTool',status:block.is_error?'failed':'completed'}})
   }else if(m.type==='result'){
    if(m.user_message_uuid&&m.user_message_uuid!==turn.uuid)continue
    if(m.user_message_uuids?.length&&!m.user_message_uuids.includes(turn.uuid))continue
    const key=m.uuid?'result:'+m.uuid:Number.isInteger(m.result_index)?'result-index:'+m.result_index:null
    if(key&&this.seen.has(key))continue
    if(key)this.seen.add(key)
    // Only an authoritative result can settle the run. Background task completion is not inferred here.
    const text=typeof m.result==='string'?m.result:turn.texts.join('\n\n')
    if(text.length>1000000)throw Error('CLAUDE_RESULT_TOO_LARGE')
    if(text)await this.emit('item/completed',{turnId:turn.id,item:{id:turn.uuid,type:'agentMessage',phase:'final_answer',text}})
    const status=m.subtype==='success'?'completed':turn.stopping?'interrupted':'failed'
    this.phase='idle'
    this.denyAll()
    this.turn=null
    await this.emit('turn/completed',{turn:{id:turn.id,status,...status==='failed'?{error:{message:'Claude Code 执行失败，原会话记录已保留。'}}:{}}})
    if(this.turn===turn)this.turn=null
   }
  }}catch{/* Process/SDK errors are untrusted and may contain credentials or prompt text. */}
  finally{if(!this.closed){this.closed=true;this.phase='unknown';this.input.close();this.denyAll();this.onClose()}}
 }
 approve(name,input,{signal,toolUseID}={}){
  if(this.closed||!this.turn||this.pending.size>=16)return Promise.resolve({behavior:'deny',message:'任务不可审批。'})
  const id=randomUUID(),turnId=this.turn.id
  return new Promise(resolve=>{
   const finish=result=>{if(!this.pending.delete(id))return;signal?.removeEventListener('abort',abort);resolve(result);if(!this.closed)void this.emit('thread/status/changed',{status:{type:'active',activeFlags:this.pending.size?['waitingOnApproval']:[]}})}
   const abort=()=>finish({behavior:'deny',message:'审批已取消。'})
   this.pending.set(id,{finish,name,input,turnId});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return}
   let method='item/commandExecution/requestApproval',params={turnId,itemId:toolUseID,cwd:this.cwd,reason:'Claude Code 请求执行 '+String(name).slice(0,80),command:name==='Bash'?String(input.command??'').slice(0,4000):JSON.stringify(input).slice(0,4000)}
   if(name==='AskUserQuestion'){
    if(!Array.isArray(input.questions)||!input.questions.length||input.questions.length>4){abort();return}
    method='item/tool/requestUserInput';params={turnId,questions:input.questions.map((q,i)=>({id:String(i),question:q.question,options:q.options,isSecret:false}))}
   }
   void this.emit('thread/status/changed',{status:{type:'active',activeFlags:['waitingOnApproval']}})
   void this.emit(method,params,id).catch(abort)
  })
 }
 respond(id,result){
  const p=this.pending.get(id);if(!p)return
  if(this.closed||!this.turn||p.turnId!==this.turn.id){p.finish({behavior:'deny',message:'原任务已结束。'});return}
  const accepted=result?.decision==='accept'||p.name==='AskUserQuestion'&&result?.answers
  p.finish(accepted?{behavior:'allow',updatedInput:p.name==='AskUserQuestion'?{...p.input,answers:Object.fromEntries(p.input.questions.map((q,i)=>[q.question,result.answers[String(i)]?.answers?.join(', ')??'']))}:p.input}:{behavior:'deny',message:'用户拒绝或审批超时。'})
 }
 write(message){this.respond(message.id,{decision:'decline'})}
 denyAll(){for(const p of [...this.pending.values()])p.finish({behavior:'deny',message:'任务已结束或连接关闭。'})}
 async interrupt(threadId,turnId){
  if(threadId!==this.id||this.turn?.id!==turnId)throw Error('CLAUDE_STALE_TURN')
  const turn=this.turn;turn.stopping=true;this.denyAll();try{await this.handle.interrupt()}catch{if(this.turn===turn)turn.stopping=false;throw Error('CLAUDE_INTERRUPT_UNCONFIRMED')}return {requested:true} // No claim that subprocesses are all stopped.
 }
 close(){if(this.closed)return;this.closed=true;this.input.close();this.denyAll();try{this.handle?.close()}catch{}this.phase='unknown'}
}
