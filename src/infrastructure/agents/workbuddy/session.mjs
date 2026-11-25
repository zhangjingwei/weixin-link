import {randomUUID} from 'node:crypto'
import {AcpTransport} from './transport.mjs'
import {workbuddyEnvironment} from './environment.mjs'
import {workbuddyContent} from './input.mjs'

export class WorkbuddySession {
 constructor({binary,cwd,onEvent=()=>{},onClose=()=>{},management,env=process.env,transportFactory=options=>new AcpTransport(options)}){
  Object.assign(this,{binary,cwd,onEvent,onClose,management,env,transportFactory});this.closed=false;this.pending=new Map();this.phase='idle';this.updates=Promise.resolve()
 }
 emit(method,params={},id){return Promise.resolve(this.onEvent({method,params:{threadId:this.id,...params},...(id?{id}:{})}))}
 async open(saved,instructions){
  if(saved.threadId&&saved.agentKind!=='workbuddy')throw Error('WORKBUDDY_SESSION_PROVIDER_MISMATCH')
  this.saved=saved
  this.transport=this.transportFactory({binary:this.binary,cwd:this.cwd,env:workbuddyEnvironment(this.env),args:['--acp','--strict-mcp-config','{"mcpServers":{}}','--permission-mode','default',...instructions?['--append-system-prompt',instructions]:[]],
   onNotification:m=>{this.updates=this.updates.then(()=>this.update(m));return this.updates},onRequest:m=>this.permission(m),onClose:()=>this.lost()})
  try{
   const init=await this.transport.call('initialize',{protocolVersion:1,clientInfo:{name:'weixin-link',version:'1'},clientCapabilities:{}})
   if(init.protocolVersion!==1)throw Error('WORKBUDDY_ACP_VERSION_UNSUPPORTED')
   const mcpServers=Object.entries(this.management?.config??{}).map(([name,server])=>({name:name.replace(/^mcp_servers\./,''),command:server.command,args:server.args??[],env:Object.entries(this.management.environment??{}).map(([name,value])=>({name,value}))}))
   if(saved.threadId&&init.agentCapabilities?.loadSession!==true)throw Error('WORKBUDDY_RESUME_UNSUPPORTED')
   const result=await this.transport.call(saved.threadId?'session/load':'session/new',{...saved.threadId?{sessionId:saved.threadId}:{},cwd:this.cwd,mcpServers})
   await this.updates
   this.id=saved.threadId??result.sessionId
   if(typeof this.id!=='string'||!this.id||result.sessionId&&result.sessionId!==this.id)throw Error('WORKBUDDY_SESSION_ID_MISMATCH')
   this.models=result.models;this.model=this.models?.currentModelId??'default';saved.agentKind='workbuddy'
   return {thread:{id:this.id},model:this.model,modelProvider:'workbuddy'}
  }catch(error){this.close();throw error}
 }
 async start({threadId,input,deliveryId,model}){
  if(this.closed||threadId!==this.id||this.turn)throw Error('WORKBUDDY_SESSION_BUSY_OR_STALE')
  const prompt=await workbuddyContent(input)
  if(model&&model!=='default'&&model!==this.model){
   if(!this.models?.availableModels?.some(m=>m.modelId===model))throw Error('WORKBUDDY_MODEL_UNAVAILABLE')
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
   if(turn.text.length+u.content.text.length>1000000)throw Error('WORKBUDDY_RESULT_TOO_LARGE')
   turn.text+=u.content.text
  }else if(['tool_call','tool_call_update'].includes(u.sessionUpdate)&&typeof u.toolCallId==='string'){
   if(u.sessionUpdate==='tool_call'){
    if(turn.text){await this.emit('item/completed',{turnId:turn.id,item:{id:randomUUID(),type:'agentMessage',phase:'commentary',text:turn.text}});turn.text=''}
    await this.emit('item/started',{turnId:turn.id,item:{id:u.toolCallId,type:'workbuddyTool',name:String(u.kind??'tool').slice(0,80)}})
   }
   if(['completed','failed'].includes(u.status))await this.emit('item/completed',{turnId:turn.id,item:{id:u.toolCallId,type:'workbuddyTool',status:u.status}})
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
   await this.emit('turn/completed',{turn:{id:turn.id,status,...status==='failed'?{error:{message:'WorkBuddy 未正常完成本轮，原生会话已保留。'}}:{}}})
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
  await this.emit('item/commandExecution/requestApproval',{turnId:turn.id,itemId:p.toolCall?.toolCallId,cwd:this.cwd,reason:'WorkBuddy 请求工具审批',command},id)
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
  if(threadId!==this.id||this.turn?.id!==turnId)throw Error('WORKBUDDY_STALE_TURN')
  this.denyAll();this.transport.notify('session/cancel',{sessionId:this.id});return {requested:true}
 }
 lost(){if(this.closed)return;this.closed=true;this.phase='unknown';this.pending.clear();this.onClose()}
 close(){if(this.closed)return;this.denyAll();this.transport?.close();this.lost()}
}
