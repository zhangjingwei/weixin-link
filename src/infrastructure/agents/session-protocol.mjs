import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {CodexRpc} from '../../base/codex/codex-rpc.mjs'
import {ClaudeRpc} from '../../base/claude/claude-rpc.mjs'
import {codexInput} from '../../base/codex/codex-input.mjs'
import {initializeCodex} from '../../base/codex/protocol-operations.mjs'
import {codexProviderOptions,providerEventCode} from '../../base/codex/provider-options.mjs'
import {nativeMemoryConfig,enableThreadMemory,publicMemoryText} from '../../base/codex/native-memory.mjs'

const clientInfo={name:'wechat_codex',title:'WeChat',version:'3.0.0'}

// SessionManager depends on this narrow agent protocol, not on either wire format.
export function createSessionProtocol({kind='codex',rpcFactory,providerEnv=process.env,codexBinary,claudeBinary,claudeStateDir,claudeEnv}={}){
 if(!['codex','claude'].includes(kind))throw Error('UNKNOWN_AGENT_BACKEND')
 const codex=kind==='codex'
 const factory=rpcFactory??(codex?options=>new CodexRpc(options):options=>new ClaudeRpc({...options,binary:claudeBinary,stateDir:claudeStateDir,env:claudeEnv}))
 const providerOptions=()=>codex?codexProviderOptions(providerEnv):{thread:{},provider:null}
 const params=({cwd,instructions,provider})=>({...codex?{config:nativeMemoryConfig,sandbox:'danger-full-access',approvalPolicy:'never'}:{},cwd,developerInstructions:instructions,...provider.thread})
 const verify=result=>{
  if(!result?.thread?.id)throw Error('底座未确认会话标识。')
  if(codex&&(result.sandbox?.type!=='dangerFullAccess'||result.approvalPolicy!=='never'))throw Error('Codex 未应用配置的会话权限。')
  return result
 }
 const resume=async(rpc,{threadId,cwd,instructions,provider})=>{
  const result=verify(await rpc.request('thread/resume',{...params({cwd,instructions,provider}),threadId,excludeTurns:true}))
  if(result.thread.id!==threadId)throw Error('底座未确认目标对话，未切换。')
  if(codex)await enableThreadMemory(rpc,threadId)
  return result
 }
 return {
  name:codex?'Codex':'Claude',kind,supportsMemory:codex,supportsModels:codex,supportsNativeCommands:codex,providerOptions,
  createRpc:options=>factory({...options,...codex?{binary:options.binary??codexBinary?.()}:{}}),
  input:codexInput,
  eventCode:providerEventCode,
  cleanOutputText:publicMemoryText,
  async workspaceRules(cwd){
   if(codex)return ''
   try{const content=await readFile(join(cwd,'AGENTS.md'),'utf8');if(Buffer.byteLength(content)>64*1024)throw Error('WORKSPACE_RULES_TOO_LARGE');return '\n\n工作区规则（AGENTS.md）：\n'+content}
   catch(error){if(error.code==='ENOENT')return '';throw error}
  },
  async initialize(rpc){if(codex)await initializeCodex(rpc,clientInfo);else await rpc.request('initialize',{clientInfo})},
  async open(rpc,{saved,cwd,instructions,provider}){
   let result
   if(saved.threadId){
    try{result=await resume(rpc,{threadId:saved.threadId,cwd,instructions,provider})}
    catch(error){if(saved.hasMessages||!error.message.includes('no rollout found for thread id'))throw error}
   }
   if(!result){result=verify(await rpc.request('thread/start',params({cwd,instructions,provider})));if(codex)await enableThreadMemory(rpc,result.thread.id)}
   return result
  },
  resume,
  read:async(rpc,threadId)=>(await rpc.request('thread/read',{threadId,includeTurns:false})).thread,
  async recoverTurn(rpc,{threadId,turnId,deliveryId}){
   if(!codex)throw Error('AGENT_RECOVERY_UNAVAILABLE')
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
  supportsRemoteTaskRecovery:codex,
  // Collaboration mode is stored on the Codex thread. Always select it for
  // each turn, otherwise a normal request after a plan can remain in Plan Mode.
  startTurn:(rpc,{threadId,input,deliveryId,plan=false,model,fastMode})=>rpc.request('turn/start',{threadId,input,...deliveryId?{clientUserMessageId:deliveryId}:{},...codex?{collaborationMode:{mode:plan?'plan':'default',settings:{model,reasoning_effort:null,developer_instructions:null}}}:{},...typeof fastMode==='boolean'&&codex?{serviceTier:fastMode?'fast':'auto'}:{}}),
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
   if(!codex)return '当前 Claude 底座未接入可验证的长期记忆开关或状态；未执行记忆修改。'
   if(command.op==='auto'){await rpc.request('thread/memoryMode/set',{threadId,mode:command.on?'enabled':'disabled'});return 'Codex已确认当前会话原生记忆模式：'+(command.on?'开启':'关闭')+'。'}
   if(command.op==='list'){const status=await rpc.request('memory/status',{});return '当前使用Codex原生记忆。\n已整合会话：'+(status.v2ConsolidatedThreads??'未知')+'；就绪：'+(status.v2Ready?'是':'否')+'。\n当前不使用微信逐条记忆库；“开启记忆”或“关闭记忆” 控制当前会话原生记忆。'}
   return '当前使用Codex原生记忆，未执行微信逐条记忆的修改或清空。可用“记忆” 查看状态。'
  },
  async models(rpc,currentModel){
   if(!codex)return 'Claude 底座暂未提供可核验的模型目录；未切换模型。'
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
   const lines=entries.map(m=>`${m.model}${currentModel===m.model?' [当前]':''}${m.isDefault?' [默认]':''}\n输入：${Array.isArray(m.inputModalities)?m.inputModalities.join('、'):'未提供'}；推理档位：${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join('、')||'未提供'}`)
   return 'Codex 返回的模型列表（只查询，不切换）：\n'+(lines.join('\n\n')||'当前未返回可显示的模型。')
  },
 }
}
