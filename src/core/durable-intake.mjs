import {stripTaskFlow,executionState} from './task-flow.mjs'
import {publicMemoryText} from '../base/codex/native-memory.mjs'
import {localTaskLabel,localCompletion} from './task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
import {transition} from './lifecycle.mjs'
export class DurableIntake {
 constructor({jobs,manager,reply,log=()=>{}}){Object.assign(this,{jobs,manager,reply,log});this.users=new Map();this.closed=false}
 submit(owner,input,key,ingressIds=[]){const id=this.jobs.add(owner,input,key,ingressIds);this.wake(owner);return id}
 cancel(owner){this.jobs.cancel(owner)}
 resume(){for(const owner of new Set(this.jobs.pending().map(j=>j.owner)))if(this.manager.owners.has(owner))this.wake(owner)}
 wake(owner){if(this.closed||this.users.has(owner))return;const run=this.pump(owner).catch(e=>this.log('queue.failed',{code:e.code??'WORKER_FAILED'})).finally(()=>{this.users.delete(owner);if(!this.closed&&this.jobs.pending().some(j=>j.owner===owner))queueMicrotask(()=>this.wake(owner))});this.users.set(owner,run)}
 async pump(owner){
  for(;;){if(this.closed)return;const job=this.jobs.pending().find(j=>j.owner===owner);if(!job)return;const token=this.manager.lifecycle.capture(owner),reply=(v,o)=>this.reply(owner,v,o)
   try{
    if(job.state==='pending'){
     const input=typeof job.input==='string'?{text:job.input}:{...job.input};input.deliveryId=job.id
     while(this.manager.sessions?.get(owner)?.busy||this.manager.sessions?.get(owner)?.finishing){if(this.closed||!token.current())return;await delay(100)}
     if(this.closed||!token.current())return
     if(input.receiptDeferred&&this.jobs.claimReceipt(job.id)&&!this.manager.state.users[owner]?.waitingAttachment){void Promise.resolve().then(()=>reply('已收到，正在处理。')).catch(()=>this.log('receipt.delivery_unconfirmed',{}))}
     await this.manager.ask(owner,input,reply,24*60*60*1000,token)
     if(token.current())this.jobs.mark(job.id,'done')
    }else await this.recover(job,reply,token)
   }catch(error){if(this.closed)return;if(token.current()){this.jobs.mark(job.id,'uncertain');const record=this.manager.state.users[owner]??={};if(record.recovery?.execution==='running'||!record.recovery)record.recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:'unknown',delivery:'unknown'};await this.manager.save();await reply('该消息的执行或发送结果尚未确认，已保留记录；不会自动重复提交。可用 /status 或 /result 查询。')}}
  }
 }
 async recover(job,reply,token){
  const session=await this.manager.connect(job.owner,reply)
  session.localTask=(job.context?.task??localTaskLabel(job.input,job.id))
  session.requestText=job.context?.request??(typeof job.input==='string'?job.input:job.input.text)
  session.attachmentContinuation=job.context?.continuation??null
  session.materials=job.context?.materials??[]
  if(session.threadId!==job.thread_id)throw Error('RECOVERY_THREAD_MISMATCH')
  for(;;){if(this.closed||!token.current()||this.jobs.get(job.id).state==='cancelled')return
   let cursor,turn
   for(let page=0;page<40;page++){const result=await session.rpc.request('thread/turns/list',{threadId:job.thread_id,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});turn=result.data.find(t=>job.turn_id?t.id===job.turn_id:(t.items??[]).some(i=>i.type==='userMessage'&&i.clientId===job.id));if(turn||!result.nextCursor)break;cursor=result.nextCursor}
   if(!turn)throw Error('SUBMISSION_UNKNOWN')
   if(job.state==='bound'){this.jobs.submitted(job.id,turn.id);job=this.jobs.get(job.id)}
   session.turnId=turn.id;session.turnReady=true;session.workToken=token;session.traceId=job.context?.flowNonce??job.id;session.startedAt=Date.now();session.finals??=[];session.items??=new Map();session.queue??=[]
   if(!['inProgress','in_progress'].includes(turn.status)){
    // Rebuild waiting state using the exact nonce persisted before submission.
    const finalText=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>publicMemoryText(i.text)).join('\n\n')
    const waiting=turn.status==='completed'&&stripTaskFlow(finalText,job.context?.flowNonce).waiting
    const record=this.manager.state.users[job.owner]
    if(waiting)record.waitingAttachment={task:session.localTask,request:session.requestText,threadId:session.threadId}
    else if(record.waitingAttachment?.task?.id===session.localTask.id)delete record.waitingAttachment
    // Delivery may have been accepted before a crash: preserve /result, never blindly resend.
    if(this.manager.state.users[job.owner].lastTask?.id!==session.localTask.id)this.manager.state.users[job.owner].lastOutput=undefined;this.manager.state.users[job.owner].lastTask=session.localTask;this.manager.state.users[job.owner].recovery={task:session.localTask,execution:executionState(turn.status,waiting),delivery:'recovered'};this.manager.state.users[job.owner].lastReply=(turn.items??[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>publicMemoryText(i.text)).join('\n\n');await this.manager.save();this.jobs.mark(job.id,'done');if(session.busy&&session.turnId===turn.id)transition(session,'idle');if(!session.busy&&!waiting)await reply(localCompletion('已恢复上一条消息的执行结果，可发 /result 查看。',session.localTask));return
   }
   const meta=await session.rpc.request('thread/read',{threadId:job.thread_id})
   if(meta.thread?.status?.type!=='active'){await this.recoverRemote(job,reply,token);return}
   this.manager.state.users[job.owner].recovery={task:session.localTask,execution:'running',delivery:null};await this.manager.save();if(!session.busy)transition(session,'running')
   await delay(1500,undefined,{signal:token.signal}).catch(()=>{})
  }
 }
 async recoverRemote(job,reply,token){
  const {RemoteController}=await import('./remote-tasks/remote-controller.mjs')
  const controller=new RemoteController({root:this.manager.cwd,scope:job.thread_id}),entries=Object.entries(await controller.store.read()).filter(([,t])=>t?.kind==='official-remote-task'&&t.scope===controller.scope&&Date.parse(t.submitted_at)>=job.created)
  if(!entries.length)throw Error('LOCAL_TURN_ABANDONED')
  for(;;){if(this.closed||!token.current())return;const results=[]
   for(const [id,t] of entries){if(!t.turn_id){const r=await controller.reconcile({task:id});if(!r.turn_id)throw Error('REMOTE_SUBMISSION_UNKNOWN')}results.push(await controller.status({task:id}))}
   if(results.every(r=>['completed','failed','interrupted'].includes(r.turn_status))){this.manager.state.users[job.owner].lastTask=(job.context?.task??localTaskLabel(job.input,job.id));this.manager.state.users[job.owner].recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:results.some(r=>r.turn_status==='failed')?'failed':results.some(r=>r.turn_status==='interrupted')?'interrupted':'completed',delivery:'recovered'};this.manager.state.users[job.owner].lastReply=results.map(r=>r.host+'：'+r.turn_status+'\n'+r.answer.filter(a=>a.phase!=='commentary').map(a=>a.text).join('\n')).join('\n\n');this.manager.state.users[job.owner].lastOutput=undefined;await this.manager.save();this.jobs.mark(job.id,'done');await reply(localCompletion('远程任务状态已恢复并核对，结果已保存，可发 /result 查看。',(job.context?.task??localTaskLabel(job.input,job.id))));return}
   await delay(2000,undefined,{signal:token.signal}).catch(()=>{})
  }
 }
 close(){this.closed=true}
}
