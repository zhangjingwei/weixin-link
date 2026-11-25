import {managementWrite} from './management-writes.mjs'

// Select a model for future turns only; never interrupt or replay a running turn.
export function requestModelSwitch(context,owner,caller,args){return managementWrite(context,owner,caller,'request_model_switch',args,async op=>{
 const entry=context.target(owner,args.projectId)
 if(entry.archived||entry.archiveIntent!==undefined)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(!(context.manager.protocolFor?.(entry.key)??context.manager.protocol).supportsModels)throw Error('MANAGEMENT_UNSUPPORTED')
 if((context.manager.providerOptions?.(entry.key)??context.manager.protocol.providerOptions?.())?.provider)throw Error('MANAGEMENT_FIXED_PROVIDER')
 const threadId=context.manager.state.users[entry.key]?.threadId??null
 const {models}=context.manager.agentFor?.(entry.key)==='claude'?await context.manager.protocol.listModels((await context.manager.connect(entry.key,context.manager.sessions.get(entry.key)?.reply??(()=>{}))).rpc):await context.conversations.withBackend(owner,rpc=>context.manager.protocol.listModels(rpc))
 if(!models.some(item=>item.model===args.model))throw Error('MANAGEMENT_MODEL_UNAVAILABLE')
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 if(context.target(owner,args.projectId)!==entry||entry.archived||entry.archiveIntent!==undefined||(context.manager.state.users[entry.key]?.threadId??null)!==threadId)throw Error('MANAGEMENT_STALE_TARGET')
 const saved=context.manager.state.users[entry.key]??={}
 const previous=saved.modelOverride??null
 saved.modelOverride=args.model
 try{await context.manager.save()}catch(error){if(previous===null)delete saved.modelOverride;else saved.modelOverride=previous;throw error}
 op.status='configured';op.data={model:args.model,previousModel:previous,effective:'next_turn',currentTurnChanged:false}
})}
