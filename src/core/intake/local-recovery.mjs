import {stripTaskFlow} from '../tasks/task-flow.mjs'
import {executionState} from '../../domain/tasks/execution-state.mjs'
import {publicMemoryText} from '../../base/codex/native-memory.mjs'
import {localTaskLabel,localCompletion} from '../delivery/task-label.mjs'
import {transition} from '../../domain/tasks/lifecycle.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export async function recover(context,job,reply,token){
  const session=await context.manager.connect(job.owner,reply)
  session.localTask=(job.context?.task??localTaskLabel(job.input,job.id))
  session.requestText=job.context?.request??(typeof job.input==='string'?job.input:job.input.text)
  session.attachmentContinuation=job.context?.continuation??null
  session.materials=job.context?.materials??[]
  if(session.threadId!==job.thread_id)throw Error('RECOVERY_THREAD_MISMATCH')
  for(;;){if(context.closed||!token.current()||context.jobs.get(job.id).state==='cancelled')return
   let cursor,turn
   for(let page=0;page<40;page++){const result=await session.rpc.request('thread/turns/list',{threadId:job.thread_id,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});turn=result.data.find(t=>job.turn_id?t.id===job.turn_id:(t.items??[]).some(i=>i.type==='userMessage'&&i.clientId===job.id));if(turn||!result.nextCursor)break;cursor=result.nextCursor}
   if(!turn)throw Error('SUBMISSION_UNKNOWN')
   if(job.state==='bound'){context.jobs.submitted(job.id,turn.id);job=context.jobs.get(job.id)}
   session.turnId=turn.id;session.turnReady=true;session.workToken=token;session.traceId=job.context?.flowNonce??job.id;session.startedAt=Date.now();session.finals??=[];session.items??=new Map();session.queue??=[]
   if(!['inProgress','in_progress'].includes(turn.status)){
    // Rebuild waiting state using the exact nonce persisted before submission.
    const finalText=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>publicMemoryText(i.text)).join('\n\n')
    const waiting=turn.status==='completed'&&stripTaskFlow(finalText,job.context?.flowNonce).waiting
    const record=context.manager.state.users[job.owner]
    if(waiting)record.waitingAttachment={task:session.localTask,request:session.requestText,threadId:session.threadId}
    else if(record.waitingAttachment?.task?.id===session.localTask.id)delete record.waitingAttachment
    // Delivery may have been accepted before a crash: preserve /result, never blindly resend.
    if(context.manager.state.users[job.owner].lastTask?.id!==session.localTask.id)context.manager.state.users[job.owner].lastOutput=undefined;context.manager.state.users[job.owner].lastTask=session.localTask;context.manager.state.users[job.owner].recovery={task:session.localTask,execution:executionState(turn.status,waiting),delivery:'recovered'};context.manager.state.users[job.owner].lastReply=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>publicMemoryText(i.text)).join('\n\n');await context.manager.save();context.jobs.mark(job.id,'done');if(session.busy&&session.turnId===turn.id)transition(session,'idle');if(!session.busy&&!waiting)await reply(localCompletion('已恢复上一条消息的执行结果，可发 “结果” 查看。',session.localTask));return
   }
   const meta=await session.rpc.request('thread/read',{threadId:job.thread_id})
   if(meta.thread?.status?.type!=='active'){await context.recoverRemote(job,reply,token);return}
   context.manager.state.users[job.owner].recovery={task:session.localTask,execution:'running',delivery:null};await context.manager.save();if(!session.busy)transition(session,'running')
   await delay(1500,undefined,{signal:token.signal}).catch(()=>{})
  }
 }
