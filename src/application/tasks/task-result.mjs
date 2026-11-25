import {createHash} from 'node:crypto'
export function recordTaskResult(record,{taskId,threadId,turnId,execution,delivery}){
 const id=createHash('sha256').update(JSON.stringify([taskId,threadId,turnId])).digest('hex')
 record.resultIdentity={id,taskId,threadId,turnId,execution,delivery,createdAt:new Date().toISOString()}
 return record.resultIdentity
}

// Retain bounded immutable result metadata in the existing session state. File
// bytes remain in OutputStore and keep their original retention/integrity rules.
export function archiveTaskResult(record,now=Date.now()){
 const identity=record.resultIdentity
 if(!identity||typeof record.lastReply!=='string')return
 const retained=(record.resultArchive??[]).filter(item=>item.identity.id!==identity.id&&Date.parse(item.identity.createdAt)>now-7*86400000)
 retained.push({identity:structuredClone(identity),lastReply:record.lastReply,...record.lastConversationUpdates?.length?{updates:[...record.lastConversationUpdates]}:{},...record.lastOutput?{lastOutput:structuredClone(record.lastOutput)}:{}})
 record.resultArchive=retained.slice(-20)
}

export function queuedHandoffKind(state,jobs,owner,taskId){
 return (state.managementOperations??[]).findLast(op=>{
  if(op.caller!==owner||op.sourceTaskId!==taskId||op.status!=='queued')return false
  const job=jobs?.get?.(op.data?.taskId)
  if(!['pending','starting','bound','submitted','done'].includes(job?.state))return false
  if(op.name==='request_agent_switch')return job.owner===owner&&job.input?.internalHandoff&&job.input.agentKind===op.data.agentKind
  return op.name==='route_conversation_request'
 })?.name
}
