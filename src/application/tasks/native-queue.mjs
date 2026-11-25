import {setTimeout as delay} from 'node:timers/promises'
import {localTaskLabel} from '../../domain/tasks/task-label.mjs'
import {currentMaterials,hasAttachments} from '../../domain/messages/material-association.mjs'

// Hand off an already prepared message while the current durable turn owns the
// writer. Its SQLite row is a delivery receipt, never a second execution queue.
export function enqueueDuringTurn(context,owner,input,id){
 const {manager,jobs}=context,session=manager.sessions?.get(owner)
 if(!session?.busy||!session.turnReady||!session.threadId||session.exiting||manager.state?.users[owner]?.agentHandoff||manager.desktopTransition||
    !(manager.protocolFor?.(owner)??manager.protocol)?.enqueue||input.agentSelection||input.internalHandoff||input.agentKind&&manager.agentFor&&(input.agentKind!==manager.agentFor(owner))||manager.backend?.prepareInput||hasAttachments(input)||input.nativeCommand||input.dependencies?.length||
    input.projectDispatch||session.waitingUser||session.waitingAttachment||manager.state.users[owner]?.waitingInput||manager.state.users[owner]?.waitingAttachment)return
 if(!jobs.get(session.taskId)?.turn_id)return
 const earlier=jobs.pending().filter(job=>job.owner===owner&&job.id!==id&&job.id!==session.taskId)
 if(earlier.some(job=>!job.context?.nativeQueue))return
 const trace=input.traceId??id,materials=currentMaterials(input,id)
 const items=[...manager.protocol.input(input,manager.agentFor?.(owner)),manager.ports.flowInput(trace),manager.ports.materialInput({materials})]
 if(!jobs.claimNativeQueue(owner,id,session.threadId,{nativeQueue:true,predecessor:{taskId:session.taskId,turnId:session.turnId},flowNonce:trace,task:localTaskLabel(input,id),materials}))return
 // All state needed to reconcile a lost reply is durable before writing the RPC.
 void manager.protocol.enqueue(session.rpc,session.threadId,id,items).catch(error=>{
  context.log('queue.native_add_unconfirmed',{trace_id:trace,code:error.definitiveRpcError?'CODEX_QUEUE_REJECTED':'CODEX_QUEUE_UNKNOWN'})
 })
}

export async function cancelNativeWaiting(context,owner){
 const {jobs,manager}=context,session=manager.sessions.get(owner)
 if(!session||session.rpc?.closed)return
 const snapshot=jobs.pending().filter(job=>job.owner===owner&&job.thread_id===session.threadId&&job.stop_request&&job.context?.nativeQueue&&!job.turn_id)
 for(const job of snapshot){
  if(context.closed||session.rpc.closed)return
  const queued=await manager.protocol.findQueued(session.rpc,job.thread_id,job.id)
  if(queued&&(await manager.protocol.removeQueued(session.rpc,job.thread_id,queued.id)).deleted)jobs.mark(job.id,'cancelled')
 }
}

export async function awaitNativeTurn(context,job,reply,token){
 const {manager,conversations}=context
 const session=manager.sessions?.get(job.owner)
 if(session?.threadId===job.thread_id&&!session.rpc?.closed)return watchNativeTurn(context,job,reply,token,session.rpc)
 const entry=conversations?.entry(job.owner)
 if(!entry||manager.state.users[job.owner]?.threadId!==job.thread_id)throw Error('RECOVERY_THREAD_MISMATCH')
 return conversations.withBackend(entry.owner,rpc=>watchNativeTurn(context,job,reply,token,rpc))
}

async function watchNativeTurn(context,job,reply,token,rpc){
 const {jobs,manager}=context
 let missingSince
 for(;;){
  if(context.closed||!token.current())return
  const row=jobs.get(job.id)
  if(!row||['done','uncertain','cancelled'].includes(row.state))return
  const queued=!row.turn_id&&await manager.protocol.findQueued(rpc,job.thread_id,job.id)
  if(queued){
   missingSince=undefined
   if(row.stop_request){
    const result=await manager.protocol.removeQueued(rpc,job.thread_id,queued.id)
    if(result.deleted){jobs.mark(job.id,'cancelled');return}
   }
  }else{
   const turn=await manager.protocol.recoverTurn(rpc,{threadId:job.thread_id,turnId:row.turn_id,deliveryId:job.id})
   if(context.closed||!token.current())return
   if(turn){
    if(!row.turn_id)jobs.submitted(job.id,turn.id)
    if(!['inProgress','in_progress'].includes(turn.status)){
     const session=manager.sessions?.get(job.owner)
     await session?.events
     if(['done','cancelled'].includes(jobs.get(job.id)?.state))return
     if(session?.nativeQueueTurn&&session.busy&&session.taskId===job.id&&!session.rpc.closed){
      await delay(250,undefined,{signal:token.signal}).catch(()=>{})
      continue
     }
     // Desktop can finish the turn while WeChat has no writer, or another
     // queued turn can already own the live session. Reconcile read-only.
     await context.recover(jobs.get(job.id),reply,token,{completedTurn:turn,rpc})
     return
    }
    if(jobs.claimRecoveredStop(jobs.get(job.id)))await manager.protocol.interrupt(rpc,job.thread_id,turn.id)
   }else{
    missingSince??=Date.now()
    if(Date.now()-missingSince>5000)throw Error('NATIVE_QUEUE_OUTCOME_UNKNOWN')
   }
  }
  await delay(1000,undefined,{signal:token.signal}).catch(()=>{})
 }
}
