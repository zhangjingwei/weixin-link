import {managementWrite} from './management-writes.mjs'
import {nativeThreadIds} from '../../domain/conversations/native-sessions.mjs'
export function conversationAgents(context,owner,args){
 const entry=context.target(owner,args.projectId),record=context.manager.state.users[entry.key]??{}
 return {projectId:entry.id,activeAgent:context.manager.agentFor(entry.key),availableAgents:context.manager.protocol.availableAgents??[context.manager.protocol.kind],nativeSessions:Object.fromEntries(Object.entries(record.nativeSessions??{}).map(([kind,item])=>[kind,{threadId:item.threadId??null}])),threadIds:nativeThreadIds(record)}
}
// A switch is a normal durable follow-up. Its source must finish successfully first.
// No independent timers, replay workers or second task ledger.
export function requestAgentSwitch(context,owner,caller,args){return managementWrite(context,owner,caller,'request_agent_switch',args,async op=>{
 const entry=context.target(owner,args.projectId),manager=context.manager
 if(entry.key!==caller)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(entry.archived||entry.deleted||entry.archiveIntent!==undefined)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(!(manager.protocol.availableAgents??[manager.protocol.kind]).includes(args.agentKind))throw Error('MANAGEMENT_AGENT_UNAVAILABLE')
 if(!context.enqueueTask)throw Error('MANAGEMENT_QUEUE_UNAVAILABLE')
 const session=manager.sessions.get(entry.key)
 if((session?.busy||session?.finishing||session?.connecting)&&caller!==entry.key)throw Error('MANAGEMENT_TARGET_BUSY')
 if(manager.submissions?.uncertainCount?.(entry.key)||manager.state.users[entry.key]?.waitingAttachment||[...manager.questions.values()].some(q=>q.session?.userId===entry.key))throw Error('MANAGEMENT_TARGET_UNCONFIRMED')
 if(args.text&&!args.handoff)throw Error('MANAGEMENT_HANDOFF_NOTE_REQUIRED')
 for(const id of args.handoff?.evidenceTaskIds??[]){
  const evidence=manager.submissions?.get(id)
  if(evidence?.owner!==entry.key||evidence.state!=='done'||!evidence.turn_id)throw Error('MANAGEMENT_HANDOFF_EVIDENCE_UNAVAILABLE')
 }
 const source=session?.busy?session.taskId:null
 if(session?.busy&&!source)throw Error('MANAGEMENT_TARGET_UNCONFIRMED')
 const pending=(manager.submissions?.pending?.()??[]).filter(job=>job.owner===entry.key&&job.id!==source)
 if(pending.length)throw Error('MANAGEMENT_TARGET_BUSY')
 op.status='queued'
 op.data={agentKind:args.agentKind,effective:'after_source_task',currentTurnChanged:false}
 if(caller===entry.key&&session?.busy)op.sourceTaskId=source
 await manager.save()
 const taskId=context.enqueueTask(entry.key,{...(args.text?{text:args.text}:{agentSelection:true}),agentKind:args.agentKind,internalHandoff:true,handoffSourceTaskId:source,...args.handoff?{handoffNote:args.handoff}:{},...source?{dependencies:[source]}:{}},'agent-handoff:'+op.id)
 op.data.taskId=taskId
})}
