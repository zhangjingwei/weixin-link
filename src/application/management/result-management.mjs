import {turnExecution,taskOutcome,outcomeEvidence} from '../../domain/tasks/task-control.mjs'
import {stripTaskFlow} from '../../infrastructure/agents/task-flow.mjs'
import {createHash} from 'node:crypto'
import {historyText} from '../conversations/history.mjs'
import {managementWrite} from './management-writes.mjs'
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function retained(context,entry,{taskId,resultId}={}){
 const current=context.manager.state.users[entry.key]??{}
 const candidates=[...(current.resultIdentity?[{...current,identity:current.resultIdentity}]:[]),...(current.resultArchive??[]).filter(item=>Date.parse(item.identity.createdAt)>context.now()-7*86400000)]
 const record=candidates.find(item=>typeof item.lastReply==='string'&&(!taskId||item.identity.taskId===taskId)&&(!resultId||item.identity.id===resultId))
 if(!record)throw Error('MANAGEMENT_RESULT_NOT_FOUND')
 const identity=record.identity
 return {record,identity,fingerprint:digest([identity.id,record.lastReply,record.lastOutput?.id])}
}
export function listProjectTasks(context,owner,args){
 const entry=context.target(owner,args.projectId)
 const page=context.manager.submissions?.listForOwner?.(entry.key,{offset:args.offset??0,limit:args.limit??20})??{items:[],nextOffset:null}
 return {...page,projectId:entry.id}
}
export async function getTaskResult(context,owner,args){
 const entry=context.target(owner,args.projectId),cursor=args.cursor?context.credential(args.cursor,'result-page',owner):null
 if(cursor&&(cursor.projectId!==entry.id||cursor.taskId!==args.taskId))throw Error('MANAGEMENT_INVALID_CURSOR')
 let value
 try{value=retained(context,entry,{taskId:args.taskId,...cursor?.resultId?{resultId:cursor.resultId}:{}})}catch(error){if(!args.taskId)throw error}
 if(args.taskId&&value?.identity.taskId!==args.taskId){
  const job=context.manager.submissions?.get(args.taskId)
  if(!job||job.owner!==entry.key||!job.thread_id||!job.turn_id)throw Error('MANAGEMENT_RESULT_NOT_FOUND')
  if(['claude','workbuddy','doubao','grok'].includes(job.input?.agentKind)||['claude','workbuddy','doubao','grok'].some(kind=>job.thread_id&&job.thread_id===context.manager.state.users[entry.key]?.nativeSessions?.[kind]?.threadId))throw Error('MANAGEMENT_RESULT_NOT_FOUND')
  const turn=await context.conversations.withBackend(owner,rpc=>context.manager.protocol.recoverTurn(rpc,{threadId:job.thread_id,turnId:job.turn_id,deliveryId:job.id}))
  if(!turn||turn.id!==job.turn_id||['inProgress','in_progress'].includes(turn.status))throw Error('MANAGEMENT_RESULT_NOT_READY')
  const raw=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>context.manager.protocol.cleanOutputText(i.text)).join('\n\n')
  const flow=stripTaskFlow(raw,job.context?.flowNonce),text=flow.text
  value={record:{lastReply:text},identity:{id:digest([job.id,job.thread_id,turn.id]),taskId:job.id,threadId:job.thread_id,turnId:turn.id,execution:turnExecution(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id}),taskOutcome:taskOutcome(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id}),outcomeEvidence:outcomeEvidence(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id}),delivery:'historical_not_tracked'},fingerprint:digest(text),historical:true}
 }
 const {record,identity,fingerprint}=value
 if(cursor&&cursor.fingerprint!==fingerprint)throw Error('MANAGEMENT_RESULT_CHANGED')
 const text=historyText(record.lastReply),offset=cursor?.offset??0,characters=Array.from(text),chunk=characters.slice(offset,offset+10000).join(''),nextOffset=offset+Math.min(10000,characters.length-offset)
 const nextCursor=nextOffset<characters.length?context.sign({kind:'result-page',owner,projectId:entry.id,taskId:args.taskId,resultId:identity.id,fingerprint,offset:nextOffset,expires:context.now()+600000}):null
 const attachments=(record.lastOutput?.attachments??[]).map(a=>({name:a.fileName,kind:a.kind,bytes:a.bytes,availability:'not_checked'}))
 const resultToken=value.historical?null:context.sign({kind:'result',owner,projectId:entry.id,resultId:identity.id,fingerprint,expires:context.now()+600000})
 return {...identity,taskOutcome:identity.taskOutcome??'unknown',projectId:entry.id,text:chunk,nextCursor,attachments,resultToken,attachmentsResent:false,redeliveryAvailable:!value.historical}
}
export function requestResultRedelivery(context,owner,caller,args){return managementWrite(context,owner,caller,'request_result_redelivery',args,async op=>{
 const entry=context.target(owner,args.projectId),token=context.credential(args.resultToken,'result',owner),value=retained(context,entry,{resultId:token.resultId})
 if(token.projectId!==entry.id||token.resultId!==value.identity.id||token.fingerprint!==value.fingerprint)throw Error('MANAGEMENT_RESULT_CHANGED')
 if(['running','unknown','waiting_attachment'].includes(value.identity.execution))throw Error('MANAGEMENT_RESULT_NOT_READY')
 op.status='pending';op.resultToken=args.resultToken;op.threadId=context.manager.state.users[entry.key]?.threadId??null
 op.snapshot={identity:structuredClone(value.identity),fingerprint:value.fingerprint,packet:value.record.lastOutput?context.manager.outputStoreFor(entry.key).replay(value.record.lastOutput):value.record.lastReply}
 op.data={resultId:value.identity.id,taskId:value.identity.taskId}
})}
export async function executeRedelivery(context,op){
 const entry=context.target(op.owner,op.projectId),token=context.credential(op.resultToken,'result',op.owner),value=op.snapshot
 if(!value||token.resultId!==value.identity.id||token.fingerprint!==value.fingerprint)throw Error('MANAGEMENT_RESULT_CHANGED')
 const store=context.manager.outputStoreFor(entry.key),packet=value.packet
 // Validate every retained file before sending even the first byte of text.
 if(typeof packet!=='string')for(const attachment of packet.attachments)try{await store.bytes(entry.key,attachment)}catch{throw Error('MANAGEMENT_ARTIFACT_UNAVAILABLE')}
 op.status='executing';op.packet=packet;await context.manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 const response=await context.deliver(entry.key,packet,{conversationControl:true,checkpoint:()=>context.manager.save()})
 op.status=['accepted','deferred','partial','unknown','cancelled','failed'].includes(response?.status)?response.status:'unknown'
 op.data={...op.data,delivery:op.status};delete op.packet;delete op.snapshot
}
export function requestTaskReconciliation(context,owner,caller,args){return managementWrite(context,owner,caller,'request_task_reconciliation',args,async op=>{
 const entry=context.target(owner,args.projectId),job=context.manager.submissions?.get(args.taskId)
 if(typeof context.manager.wakeRecovery!=='function')throw Error('MANAGEMENT_RECOVERY_UNAVAILABLE')
 if(entry.archived)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(!job||job.owner!==entry.key)throw Error('MANAGEMENT_TASK_NOT_FOUND')
 if(job.state!=='uncertain'||!job.thread_id)throw Error('MANAGEMENT_TASK_NOT_RECONCILABLE')
 if(context.manager.state.users[entry.key]?.threadId!==job.thread_id)throw Error('MANAGEMENT_STALE_TARGET')
 const target=context.manager.sessions.get(entry.key)
 if(entry.key!==caller&&(target?.busy||target?.finishing||target?.connecting))throw Error('MANAGEMENT_TARGET_BUSY')
 op.taskId=job.id;op.threadId=job.thread_id;op.callerTask=context.manager.sessions.get(caller)?.traceId;op.status='pending'
})}
export async function executeReconciliation(context,op){
 const entry=context.target(op.owner,op.projectId),caller=context.manager.sessions.get(op.caller),target=context.manager.sessions.get(entry.key)
 if(caller?.traceId!==op.callerTask)throw Error('MANAGEMENT_SUPERSEDED')
 if(caller?.busy||caller?.finishing||target?.busy||target?.finishing||target?.connecting){await context.activate(op.caller,op.id);return false}
 if(context.manager.state.users[entry.key]?.threadId!==op.threadId)throw Error('MANAGEMENT_STALE_TARGET')
 op.status='executing';await context.manager.save()
 const live=context.manager.sessions.get(entry.key)
 if(live?.busy||live?.finishing||live?.connecting||context.manager.sessions.get(op.caller)?.traceId!==op.callerTask||context.manager.state.users[entry.key]?.threadId!==op.threadId)throw Error('MANAGEMENT_TARGET_BUSY')
 const changed=context.manager.submissions.recheckTask(entry.key,op.taskId,op.threadId)
 if(!changed)throw Error('MANAGEMENT_TASK_NOT_RECONCILABLE')
 context.manager.wakeRecovery?.(entry.key);op.status='requested';op.data={taskId:op.taskId,reexecuted:false}
 return true
}
