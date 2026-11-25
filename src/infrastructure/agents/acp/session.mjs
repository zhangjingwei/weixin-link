import {randomUUID} from 'node:crypto'
import {AcpTransport} from './transport.mjs'
import {acpContent} from './input.mjs'

export class AcpSession {
 constructor({binary,cwd,onEvent=()=>{},onClose=()=>{},management,env=process.env,kind,name,args,environment,authenticate=async()=>{},promptInstructions=false,requireImageCapability=false,errorPrefix=kind.toUpperCase(),transportFactory=options=>new AcpTransport({...options,errorPrefix})}){
  Object.assign(this,{binary,cwd,onEvent,onClose,management,env,transportFactory,kind,name,args,environment,authenticate,promptInstructions,requireImageCapability,errorPrefix});this.closed=false;this.pending=new Map();this.phase='idle';this.updates=Promise.resolve()
 }
 emit(method,params={},id){return Promise.resolve(this.onEvent({method,params:{threadId:this.id,...params},...(id?{id}:{})}))}
 async open(saved,instructions){
  if(saved.threadId&&saved.agentKind!==this.kind)throw Error(`${this.errorPrefix}_SESSION_PROVIDER_MISMATCH`)
  this.saved=saved;this.instructions=instructions
  this.transport=this.transportFactory({binary:this.binary,cwd:this.cwd,env:this.environment(this.env),args:this.args(instructions),
   onNotification:m=>{this.updates=this.updates.then(()=>this.update(m));return this.updates},onRequest:m=>this.permission(m),onClose:()=>this.lost()})
  try{
   const init=await this.transport.call('initialize',{protocolVersion:1,clientInfo:{name:'weixin-link',version:'1'},clientCapabilities:{}})
   if(init.protocolVersion!==1)throw Error(`${this.errorPrefix}_ACP_VERSION_UNSUPPORTED`)
   this.promptCapabilities=init.agentCapabilities?.promptCapabilities??{}
   await this.authenticate(this.transport,init)
   const mcpServers=Object.entries(this.management?.config??{}).map(([name,server])=>({name:name.replace(/^mcp_servers\./,''),command:server.command,args:server.args??[],env:Object.entries(this.management.environment??{}).map(([name,value])=>({name,value}))}))
   if(saved.threadId&&init.agentCapabilities?.loadSession!==true)throw Error(`${this.errorPrefix}_RESUME_UNSUPPORTED`)
   const result=await this.transport.call(saved.threadId?'session/load':'session/new',{...saved.threadId?{sessionId:saved.threadId}:{},cwd:this.cwd,mcpServers})
   await this.updates
   this.id=saved.threadId??result.sessionId
   if(typeof this.id!=='string'||!this.id||result.sessionId&&result.sessionId!==this.id)throw Error(`${this.errorPrefix}_SESSION_ID_MISMATCH`)
   this.models=result.models;this.model=this.models?.currentModelId??'default';saved.agentKind=this.kind
   return {thread:{id:this.id},model:this.model,modelProvider:this.kind}
  }catch(error){this.close();if(error.message?.startsWith(this.errorPrefix+'_'))error.code??=error.message;throw error}
 }
 async start({threadId,input,deliveryId,model}){
  if(this.closed||threadId!==this.id||this.turn)throw Error(`${this.errorPrefix}_SESSION_BUSY_OR_STALE`)
  if(this.requireImageCapability&&input.some(item=>item.type==='localImage')&&this.promptCapabilities.image!==true)throw Error(`${this.errorPrefix}_IMAGE_UNSUPPORTED`)
  const prompt=await acpContent(input,this.errorPrefix)
  if(this.promptInstructions&&this.instructions)prompt.unshift({type:'text',text:this.instructions})
  if(model&&model!=='default'&&model!==this.model){
   if(!this.models?.availableModels?.some(m=>m.modelId===model))throw Error(`${this.errorPrefix}_MODEL_UNAVAILABLE`)
   await this.transport.call('session/set_model',{sessionId:this.id,modelId:model});this.model=model
  }
  const turn=this.turn={id:randomUUID(),text:'',started:false};this.phase='active';this.observedAt=null
  void this.run(turn,prompt)
  return {turn:{id:turn.id},deliveryId}
 }
 async activity(turn){
  this.observedAt=Date.now()
  if(!turn.started){turn.started=true;await this.emit('turn/started',{turn:{id:turn.id}})}
  await this.emit('agent/activity',{turnId:turn.id})
 }
 async update(message){
  const turn=this.turn,p=message.params,u=p?.update
  // Replay and child events are never the main turn's answer.
  if(this.closed||message.method!=='session/update'||!turn||p.sessionId!==this.id||!u||p._meta?.['codebuddy.ai/memberEvent']||u._meta?.['codebuddy.ai/memberEvent'])return
  if(!['agent_message_chunk','agent_thought_chunk','tool_call','tool_call_update'].includes(u.sessionUpdate))return
  await this.activity(turn)
  if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text'){
   if(turn.text.length+u.content.text.length>1000000)throw Error(`${this.errorPrefix}_RESULT_TOO_LARGE`)
   turn.text+=u.content.text
  }else if(['tool_call','tool_call_update'].includes(u.sessionUpdate)&&typeof u.toolCallId==='string'){
   if(u.sessionUpdate==='tool_call'){
    if(turn.text){await this.emit('item/completed',{turnId:turn.id,item:{id:randomUUID(),type:'agentMessage',phase:'commentary',text:turn.text}});turn.text=''}
    await this.emit('item/started',{turnId:turn.id,item:{id:u.toolCallId,type:this.kind+'Tool',name:String(u.kind??'tool').slice(0,80)}})
   }
   if(['completed','failed'].includes(u.status))await this.emit('item/completed',{turnId:turn.id,item:{id:u.toolCallId,type:this.kind+'Tool',status:u.status}})
  }
 }
 async run(turn,prompt){
  try{
   // No inference timeout/retry: an interrupted transport leaves execution unknown.
   const result=await this.transport.call('session/prompt',{sessionId:this.id,prompt},{timeout:0})
   await this.updates
   if(this.closed||this.turn!==turn)return
   const status={end_turn:'completed',cancelled:'interrupted',max_tokens:'failed',max_turn_requests:'failed',refusal:'failed'}[result.stopReason]
   if(!status){this.close();return}
   await this.activity(turn)
   if(turn.text)await this.emit('item/completed',{turnId:turn.id,item:{id:turn.id,type:'agentMessage',phase:'final_answer',text:turn.text}})
   this.denyAll();this.turn=null;this.phase='idle'
   await this.emit('thread/status/changed',{status:{type:'idle',activeFlags:[]}})
   await this.emit('turn/completed',{turn:{id:turn.id,status,...status==='failed'?{error:{message:`${this.name} 未正常完成本轮，原生会话已保留。`}}:{}}})
  }catch{this.close()}
 }
 async permission(message){
  if(message.method!=='session/request_permission'){this.transport.reject(message.id);return}
  const p=message.params,turn=this.turn
  if(!turn||p?.sessionId!==this.id||this.closed||this.pending.size>=16){this.transport.respond(message.id,{outcome:{outcome:'cancelled'}});return}
  const options=Array.isArray(p.options)?p.options:[],allow=options.find(o=>o.kind==='allow_once'&&typeof o.optionId==='string'),reject=options.find(o=>o.kind==='reject_once'&&typeof o.optionId==='string')
  if(!allow){this.transport.respond(message.id,{outcome:{outcome:'cancelled'}});return}
  const command=[String(p.toolCall?.title??''),p.toolCall?.rawInput===undefined?'':JSON.stringify(p.toolCall.rawInput)].filter(Boolean).join('\n')
  if(!command||command.length>4000){this.transport.respond(message.id,{outcome:{outcome:'cancelled'}});return}
  const id=randomUUID();this.pending.set(id,{requestId:message.id,turnId:turn.id,allow:allow.optionId,reject:reject?.optionId})
  await this.activity(turn)
  await this.emit('thread/status/changed',{status:{type:'active',activeFlags:['waitingOnApproval']}})
  // Show the exact offered operation; never automatically grant persistent permissions.
  await this.emit('item/commandExecution/requestApproval',{turnId:turn.id,itemId:p.toolCall?.toolCallId,cwd:this.cwd,reason:this.name+' 请求工具审批',command},id)
 }
 respond(id,result){
  const p=this.pending.get(id);if(!p)return;this.pending.delete(id)
  const optionId=this.turn?.id===p.turnId&&result?.decision==='accept'?p.allow:p.reject
  this.transport.respond(p.requestId,{outcome:optionId?{outcome:'selected',optionId}:{outcome:'cancelled'}})
  if(!this.closed)void this.emit('thread/status/changed',{status:{type:'active',activeFlags:this.pending.size?['waitingOnApproval']:[]}})
 }
 write(message){this.respond(message.id,{decision:'decline'})}
 denyAll(){for(const id of [...this.pending.keys()])this.respond(id,{decision:'decline'})}
 async interrupt(threadId,turnId){
  if(threadId!==this.id||this.turn?.id!==turnId)throw Error(`${this.errorPrefix}_STALE_TURN`)
  this.denyAll();this.transport.notify('session/cancel',{sessionId:this.id});return {requested:true}
 }
 lost(){if(this.closed)return;this.closed=true;this.phase='unknown';this.pending.clear();this.onClose()}
 close(){if(this.closed)return;this.denyAll();this.transport?.close();this.lost()}
}
