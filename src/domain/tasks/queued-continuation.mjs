// Only an exact, recorded queue predecessor may consume a persisted input wait.
export function queuedContinuation(record,job){
 if(job.context?.continuation)return job.context.continuation
 const waiting=record?.waitingInput??record?.waitingAttachment,prior=job.context?.predecessor
 if(!waiting||waiting.threadId!==job.thread_id||!waiting.sourceTaskId||!waiting.turnId||prior?.taskId!==waiting.sourceTaskId||prior.turnId!==waiting.turnId)return null
 const input=job.input
 const attached=input&&typeof input==='object'&&['attachments','images','audios'].some(key=>input[key]?.length)
 return waiting.kind==='answer'||attached?waiting:null
}
export function consumeQueuedWaiting(record,continuation){
 if(!continuation?.sourceTaskId||!continuation.turnId)return false
 let changed=false
 for(const key of ['waitingInput','waitingAttachment']){
  const wait=record?.[key]
  if(wait?.sourceTaskId===continuation.sourceTaskId&&wait.turnId===continuation.turnId&&wait.threadId===continuation.threadId){delete record[key];changed=true}
 }
 return changed
}
