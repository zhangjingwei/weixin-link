import {CodexRpc} from '../../base/codex/codex-rpc.mjs'
import {codexInput} from '../../base/codex/codex-input.mjs'
import {initializeCodex} from '../../base/codex/protocol-operations.mjs'
import {codexProviderOptions,providerEventCode} from '../../base/codex/provider-options.mjs'
import {nativeMemoryConfig,enableThreadMemory,publicMemoryText} from '../../base/codex/native-memory.mjs'
import {workflowTurnGuidance} from './workflow-turn.mjs'

const clientInfo={name:'wechat_codex',title:'WeChat',version:'3.0.0'}

// SessionManager depends on this narrow agent protocol, not on either wire format.
export function createSessionProtocol({rpcFactory,providerEnv=process.env,providerSecrets={},codexBinary,codexHome}={}){
 const factory=rpcFactory??(options=>new CodexRpc(options))
 const providerOptions=()=>codexProviderOptions({...providerEnv,...providerSecrets})
 const managementConfigs=new WeakMap()
 const params=(rpc,{cwd,instructions,provider})=>({config:{...nativeMemoryConfig,...managementConfigs.get(rpc)},sandbox:'danger-full-access',approvalPolicy:'never',cwd,developerInstructions:instructions,...provider.thread})
 const verify=result=>{
  if(!result?.thread?.id)throw Error('底座未确认会话标识。')
  if(result.sandbox?.type!=='dangerFullAccess'||result.approvalPolicy!=='never')throw Error('Codex 未应用配置的会话权限。')
  return result
 }
 const resume=async(rpc,{threadId,cwd,instructions,provider})=>{
  let result
  try{
   result=verify(await rpc.request('thread/resume',{...params(rpc,{cwd,instructions,provider}),threadId,excludeTurns:true}))
  }catch(error){
   if(error.definitiveRpcError&&error.rpcCode===-32600&&/already has an active writer/i.test(error.message)){
    throw Object.assign(Error('已在另一个应用中打开。请先在那边关闭会话，才能在这里继续。'),{code:'CODEX_THREAD_WRITER_BUSY',threadId})
   }
   throw error
  }
  if(result.thread.id!==threadId)throw Error('底座未确认目标对话，未切换。')
  await enableThreadMemory(rpc,threadId)
  return result
 }
 return {
  name:'Codex',kind:'codex',supportsMemory:true,supportsModels:true,supportsNativeCommands:true,providerOptions,
  createRpc(options){
   const management=options.management,selected=options.providerOptions??providerOptions(),args=[...selected.args]
   // Codex discovers MCP servers at app-server startup. Thread-only overrides
   // do not populate its management channel. Secrets go via env, never argv.
   for(const [table,fields]of Object.entries(management?.config??{}))for(const [key,value]of Object.entries(fields))args.push('-c',`${table}.${key}=${JSON.stringify(value)}`)
   const rpc=factory({...options,providerOptions:{...selected,args},binary:options.binary??codexBinary?.(),codexHome,providerSecrets:{...providerSecrets,...management?.environment}})
   if(management)managementConfigs.set(rpc,management.config)
   return rpc
  },
  input:codexInput,
  eventCode:providerEventCode,
  cleanOutputText:publicMemoryText,
  async workspaceRules(){return ''},
  async initialize(rpc){await initializeCodex(rpc,clientInfo)},
  async open(rpc,{saved,cwd,instructions,provider}){
   if(saved.modelOverride&&!provider.provider)provider={...provider,thread:{...provider.thread,model:saved.modelOverride}}
   let result
   if(saved.threadId){
    try{result=await resume(rpc,{threadId:saved.threadId,cwd,instructions,provider})}
    catch(error){if(saved.nativeProjectId||saved.hasMessages||!error.message.includes('no rollout found for thread id'))throw error}
   }
   if(!result){result=verify(await rpc.request('thread/start',{...params(rpc,{cwd,instructions,provider}),...(saved.nativeProjectId?{projectId:saved.nativeProjectId}:{})}));if(saved.nativeProjectId&&result.thread.projectId!==saved.nativeProjectId)throw Error('CODEX_PROJECT_THREAD_UNCONFIRMED');await enableThreadMemory(rpc,result.thread.id)}
   return result
  },
  unsubscribe:(rpc,threadId)=>rpc.request('thread/unsubscribe',{threadId},2000),
  resume,
  read:async(rpc,threadId)=>(await rpc.request('thread/read',{threadId,includeTurns:false})).thread,
  async recoverTurn(rpc,{threadId,turnId,deliveryId}){
   let cursor
   for(let page=0;page<40;page++){
    const result=await rpc.request('thread/turns/list',{threadId,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})})
    const turn=result.data.find(item=>turnId?item.id===turnId:(item.items??[]).some(message=>message.type==='userMessage'&&message.clientId===deliveryId))
    if(turn)return turn
    if(!result.nextCursor)break
    cursor=result.nextCursor
   }
   return null
  },
  enqueue:(rpc,threadId,clientUserMessageId,input)=>rpc.request('thread/queue/add',{threadId,clientUserMessageId,input}),
  removeQueued:(rpc,threadId,queuedSubmissionId)=>rpc.request('thread/queue/delete',{threadId,queuedSubmissionId}),
  async findQueued(rpc,threadId,clientId){
   let cursor
   for(let page=0;page<40;page++){
    const result=await rpc.request('thread/queue/list',{threadId,limit:100,...(cursor?{cursor}:{})})
    const found=result.data.find(item=>item.clientUserMessageId===clientId)
    if(found||!result.nextCursor)return found
    cursor=result.nextCursor
   }
   throw Error('CODEX_QUEUE_PAGINATION_LIMIT')
  },
  supportsRemoteTaskRecovery:true,
  // Collaboration mode is stored on the Codex thread. Explicitly select the
  // default mode on every WeChat turn, including resumed threads.
  startTurn:(rpc,{threadId,input,deliveryId,model,fastMode,workflowRequest,workflowMode})=>rpc.request('turn/start',{threadId,input,...deliveryId?{clientUserMessageId:deliveryId}:{},collaborationMode:{mode:'default',settings:{model,reasoning_effort:null,developer_instructions:workflowTurnGuidance(workflowRequest,workflowMode)}},...typeof fastMode==='boolean'?{serviceTier:fastMode?'fast':'auto'}:{}}),
  startReview:(rpc,threadId,target)=>rpc.request('review/start',{threadId,target}),
  goal:async(rpc,threadId,command)=>{
   if(command.op==='get')return (await rpc.request('thread/goal/get',{threadId})).goal
   if(command.op==='clear')return (await rpc.request('thread/goal/clear',{threadId,origin:'user'})).goal
   const fields=command.op==='create'?{objective:command.objective,status:'active',...command.tokenBudget?{tokenBudget:command.tokenBudget}:{}}:{status:{pause:'paused',resume:'active',complete:'complete'}[command.op]}
   return (await rpc.request('thread/goal/set',{threadId,origin:'user',...fields})).goal
  },
  compact:(rpc,threadId)=>rpc.request('thread/compact/start',{threadId}),
  fork:(rpc,threadId)=>rpc.request('thread/fork',{threadId,excludeTurns:true}),
  interrupt:(rpc,threadId,turnId)=>rpc.request('turn/interrupt',{threadId,turnId}),
  steer:(rpc,threadId,turnId,text)=>rpc.request('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text}]}),
  async memory(rpc,threadId,command){
   if(command.op==='auto'){await rpc.request('thread/memoryMode/set',{threadId,mode:command.on?'enabled':'disabled'});return 'Codex已确认当前会话原生记忆模式：'+(command.on?'开启':'关闭')+'。'}
   if(command.op==='list'){const status=await rpc.request('memory/status',{});return '当前使用Codex原生记忆。\n已整合会话：'+(status.v2ConsolidatedThreads??'未知')+'；就绪：'+(status.v2Ready?'是':'否')+'。\n当前不使用微信逐条记忆库；“开启记忆”或“关闭记忆” 控制当前会话原生记忆。'}
   return '当前使用Codex原生记忆，未执行微信逐条记忆的修改或清空。可用“记忆” 查看状态。'
  },
  async listModels(rpc){
   const models=[],cursors=new Set();let cursor
   for(let page=0;page<10;page++){
    const result=await rpc.request('model/list',{limit:50,includeHidden:false,...cursor?{cursor}:{}})
    if(!Array.isArray(result.data))throw Error('Codex 未返回有效的模型列表。')
    models.push(...result.data);cursor=result.nextCursor
    if(!cursor)break
    if(cursors.has(cursor))throw Error('Codex 模型列表分页异常，请稍后重试。')
    cursors.add(cursor)
   }
   if(cursor)throw Error('模型列表超过查询上限，请在主机查看。')
   const entries=[...new Map(models.filter(m=>typeof m.model==='string'&&!m.hidden).map(m=>[m.model,m])).values()]
   return {models:entries.map(({model,displayName,isDefault,inputModalities,supportedReasoningEfforts})=>({model,displayName,isDefault,inputModalities,supportedReasoningEfforts}))}
  },
  async models(rpc,currentModel){
   const {models:entries}=await this.listModels(rpc)
   const lines=entries.map(m=>`${m.model}${currentModel===m.model?' [当前]':''}${m.isDefault?' [默认]':''}\n输入：${Array.isArray(m.inputModalities)?m.inputModalities.join('、'):'未提供'}；推理档位：${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join('、')||'未提供'}`)
   return 'Codex 返回的模型列表（只查询，不切换）：\n'+(lines.join('\n\n')||'当前未返回可显示的模型。')
  },
 }
}
