import {acpInput} from './input.mjs'
export function createAcpProtocol({kind,name,Session,binary,inspect,env=process.env}){
 const prefix=kind.toUpperCase()
 return {kind,name,supportsSteer:false,supportsNativeCatalog:false,supportsMemory:false,supportsModels:true,supportsNativeCommands:false,supportsRemoteTaskRecovery:false,
  providerOptions:()=>({thread:{},args:[]}),input:value=>acpInput(value,prefix),cleanOutputText:text=>String(text??'').trim(),eventCode:()=>null,workspaceRules:async()=>'',
  createRpc:options=>new Session({...options,binary,env}),
  initialize:async()=>{await inspect(binary,{env})},
  open:(rpc,{saved,instructions})=>rpc.open(saved,instructions),
  startTurn:(rpc,options)=>rpc.start(options),
  read:async(rpc,id)=>{
   if(rpc.id!==id||rpc.closed)throw Error(`${prefix}_SESSION_UNAVAILABLE`)
   return {id,cwd:rpc.cwd,status:{type:rpc.phase==='active'&&(rpc.observedAt==null||Date.now()-rpc.observedAt>90000)?'unknown':rpc.phase,activeFlags:rpc.pending.size?['waitingOnApproval']:[]}}
  },
  interrupt:(rpc,threadId,turnId)=>rpc.interrupt(threadId,turnId),
  // Absence of an authoritative terminal record is unknown; never re-submit a prompt.
  recoverTurn:async(rpc,{threadId,turnId})=>{
   if(rpc.id!==threadId)return null
   const record=rpc.saved,candidates=[...(record.resultArchive??[]),{identity:record.resultIdentity,lastReply:record.lastReply}]
   const result=candidates.find(r=>r.identity?.threadId===threadId&&r.identity.turnId===turnId&&['completed','interrupted','failed'].includes(r.identity.execution))
   return result?{id:turnId,status:result.identity.execution,items:[{type:'agentMessage',text:result.lastReply??''}]}:null
  },
  steer:async()=>({unsupported:true}),
  memory:async()=>name+' 使用自身原生会话与配置；不支持 Codex 记忆命令。',
  listModels:async rpc=>({models:(rpc.models?.availableModels??[]).map(m=>({model:m.modelId,displayName:m.name??m.modelId,isDefault:m.modelId===rpc.model,inputModalities:['text','image']}))}),
  async models(rpc){const {models}=await this.listModels(rpc);return models.map(m=>m.model+' · '+m.displayName).join('\n')},
 }
}
