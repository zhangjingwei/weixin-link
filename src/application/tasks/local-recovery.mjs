import {queuedContinuation,consumeQueuedWaiting} from '../../domain/tasks/queued-continuation.mjs'
import {stripTaskFlow} from '../../infrastructure/agents/task-flow.mjs'
import {turnExecution,taskOutcome,outcomeEvidence} from '../../domain/tasks/task-control.mjs'
import {recordTaskResult,archiveTaskResult,hasQueuedHandoff} from './task-result.mjs'
import {localTaskLabel,localCompletion} from '../../domain/tasks/task-label.mjs'
import {transition} from '../../domain/tasks/lifecycle.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export async function recover(context,job,reply,token,{completedTurn,rpc}={}){
  const session=completedTurn?{threadId:job.thread_id,rpc}:await context.manager.connect(job.owner,reply)
  const continuation=job.context?.nativeQueue?queuedContinuation(context.manager.state.users[job.owner],job):null
  if(continuation){
   job={...job,context:{...job.context,task:continuation.task,continuation}}
   context.jobs.context(job.id,job.context)
  }
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
    // Rebuild control exclusively from the durable typed operation, never from reply text.
    const rawFinalText=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>context.manager.protocol.cleanOutputText(i.text)).join('\n\n')
    const finalText=stripTaskFlow(rawFinalText,job.context?.flowNonce).text
    const execution=turnExecution(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id})
    const waiting=execution==='waiting_attachment'
    const handedOff=hasQueuedHandoff(context.manager.state,context.jobs,job.owner,job.id)
    const outcome=taskOutcome(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id},{handedOff})
    session.waitingAttachment=waiting;session.waitingUser=execution==='waiting_user'
    const record=context.manager.state.users[job.owner]
    if(execution==='waiting_user')record.waitingInput={kind:'answer',task:session.localTask,request:session.requestText,threadId:session.threadId,sourceTaskId:job.id,turnId:turn.id}
    else if(record.waitingInput?.sourceTaskId===job.id&&record.waitingInput.turnId===turn.id)delete record.waitingInput
    if(waiting)record.waitingAttachment={task:session.localTask,request:session.requestText,threadId:session.threadId,sourceTaskId:job.id,turnId:turn.id}
    else if(record.waitingAttachment?.sourceTaskId===job.id&&record.waitingAttachment.turnId===turn.id)delete record.waitingAttachment
    if(!waiting&&execution!=='waiting_user')consumeQueuedWaiting(record,session.attachmentContinuation)
    // Delivery may have been accepted before a crash: preserve the result, never blindly resend.
    archiveTaskResult(record)
    if(record.resultIdentity?.turnId!==turn.id||record.resultIdentity?.threadId!==job.thread_id)delete record.lastConversationUpdates
    if(context.manager.state.users[job.owner].lastTask?.id!==session.localTask.id)context.manager.state.users[job.owner].lastOutput=undefined;context.manager.state.users[job.owner].lastTask=session.localTask;context.manager.state.users[job.owner].recovery={task:session.localTask,execution,delivery:'recovered'};context.manager.state.users[job.owner].lastReply=finalText;recordTaskResult(record,{taskId:job.id,threadId:job.thread_id,turnId:turn.id,execution,delivery:'recovered'});record.resultIdentity.taskOutcome=outcome;record.resultIdentity.outcomeEvidence=outcomeEvidence(turn.status,job.context?.control,{taskId:job.id,threadId:job.thread_id,turnId:turn.id},{handedOff});record.recovery.outcome=outcome
    const native=job.context?.nativeQueue
    if(native)record.resultIdentity.delivery=record.recovery.delivery='unknown'
    if(native&&context.jobs.claimReceipt('native-final:'+job.id)){
     const message=finalText||(execution==='unknown'?'原任务状态待核对；未确认执行结束。':waiting?'正在等待附件。':turn.status==='failed'?'本轮任务失败。':turn.status==='interrupted'?'本轮任务已停止。':'本轮已结束，没有文字回复。')
     const output=await context.manager.outputStoreFor(job.owner).package(job.owner,message,[],token.signal)
     if(typeof output==='object')record.lastOutput=output
     await context.manager.save()
     if(context.closed||!token.current())return
     const result=await reply(output,{current:()=>token.current()&&!context.closed})
     record.resultIdentity.delivery=record.recovery.delivery=result?.status??'unknown'
    }
    await context.manager.save()
    context.jobs.markOutcome?.(job.id,execution==='completed'&&['completed','handed_off'].includes(outcome)?'completed':'not_confirmed')
    context.jobs.mark(job.id,execution==='unknown'?'uncertain':'done')
    if(session.busy&&session.turnId===turn.id)transition(session,'idle')
    if(!native&&!session.busy&&!waiting&&execution!=='waiting_user')await reply(localCompletion(execution==='unknown'?'上次任务的执行状态仍待核对；已保存可读取内容，不会重复执行。':'已找回上一次任务的结果，你可以说“看看上次的结果”。',session.localTask));return
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
