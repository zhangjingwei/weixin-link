import {recordTaskResult,archiveTaskResult} from './task-result.mjs'
import {stripTaskFlow} from '../../infrastructure/agents/task-flow.mjs'
import {executionState} from '../../domain/tasks/execution-state.mjs'
import {localTaskLabel,localCompletion} from '../../domain/tasks/task-label.mjs'
import {transition} from '../../domain/tasks/lifecycle.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export async function recover(context,job,reply,token,{completedTurn,rpc}={}){
  const session=completedTurn?{threadId:job.thread_id,rpc}:await context.manager.connect(job.owner,reply)
  session.taskId=job.id
  session.localTask=(job.context?.task??localTaskLabel(job.input,job.id))
  session.requestText=job.context?.request??(typeof job.input==='string'?job.input:job.input.text)
  session.attachmentContinuation=job.context?.continuation??null
  session.materials=job.context?.materials??[]
  if(session.threadId!==job.thread_id)throw Error('RECOVERY_THREAD_MISMATCH')
  for(;;){if(context.closed||!token.current()||context.jobs.get(job.id).state==='cancelled')return
   const turn=completedTurn??await context.manager.protocol.recoverTurn(session.rpc,{threadId:job.thread_id,turnId:job.turn_id,deliveryId:job.id})
   if(!turn)throw Error('SUBMISSION_UNKNOWN')
   if(job.state==='bound'){context.jobs.submitted(job.id,turn.id);job=context.jobs.get(job.id)}
   session.turnId=turn.id;session.turnReady=true;session.workToken=token;session.traceId=job.context?.flowNonce??job.id;session.startedAt=Date.now();session.finals??=[];session.items??=new Map();session.queue??=[]
   if(!['inProgress','in_progress'].includes(turn.status)){
    // Rebuild waiting state using the exact nonce persisted before submission.
    const finalText=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>context.manager.protocol.cleanOutputText(i.text)).join('\n\n')
    const waiting=turn.status==='completed'&&stripTaskFlow(finalText,job.context?.flowNonce).waiting
    const record=context.manager.state.users[job.owner]
    if(waiting)record.waitingAttachment={task:session.localTask,request:session.requestText,threadId:session.threadId}
    else if(record.waitingAttachment?.task?.id===session.localTask.id)delete record.waitingAttachment
    // Delivery may have been accepted before a crash: preserve the result, never blindly resend.
    archiveTaskResult(record)
    if(record.resultIdentity?.turnId!==turn.id||record.resultIdentity?.threadId!==job.thread_id)delete record.lastConversationUpdates
    if(context.manager.state.users[job.owner].lastTask?.id!==session.localTask.id)context.manager.state.users[job.owner].lastOutput=undefined;context.manager.state.users[job.owner].lastTask=session.localTask;context.manager.state.users[job.owner].recovery={task:session.localTask,execution:executionState(turn.status,waiting),delivery:'recovered'};context.manager.state.users[job.owner].lastReply=finalText;recordTaskResult(record,{taskId:job.id,threadId:job.thread_id,turnId:turn.id,execution:executionState(turn.status,waiting),delivery:'recovered'})
    const native=job.context?.nativeQueue
    if(native)record.resultIdentity.delivery=record.recovery.delivery='unknown'
    if(native&&context.jobs.claimReceipt('native-final:'+job.id)){
     const message=finalText||(waiting?'正在等待附件。':turn.status==='failed'?'本轮任务失败。':turn.status==='interrupted'?'本轮任务已停止。':'本轮已结束，没有文字回复。')
     const output=await context.manager.outputStoreFor(job.owner).package(job.owner,message,[],token.signal)
     if(typeof output==='object')record.lastOutput=output
     await context.manager.save()
     if(context.closed||!token.current())return
     const result=await reply(output,{current:()=>token.current()&&!context.closed})
     record.resultIdentity.delivery=record.recovery.delivery=result?.status??'unknown'
    }
    await context.manager.save()
    context.jobs.markOutcome?.(job.id,turn.status==='completed'&&!waiting?'completed':'not_confirmed')
    context.jobs.mark(job.id,'done')
    if(session.busy&&session.turnId===turn.id)transition(session,'idle')
    if(!native&&!session.busy&&!waiting)await reply(localCompletion('已找回上一次任务的结果，你可以说“看看上次的结果”。',session.localTask));return
   }
   if(turn.id===job.turn_id && context.jobs.claimRecoveredStop?.(job)){
    await context.manager.protocol.interrupt(session.rpc,job.thread_id,turn.id)
   }
   const meta=await context.manager.protocol.read(session.rpc,job.thread_id)
   if(meta?.status?.type!=='active'){
    throw Error('LOCAL_TURN_ABANDONED')
   }
   context.manager.state.users[job.owner].recovery={task:session.localTask,execution:'running',delivery:null};await context.manager.save();if(!session.busy)transition(session,'running')
   await delay(1500,undefined,{signal:token.signal}).catch(()=>{})
  }
 }
