import {recover} from './intake/local-recovery.mjs'
import {recoverRemote} from './intake/remote-recovery.mjs'
import {localTaskLabel} from './delivery/task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export class DurableIntake {
 constructor({jobs,manager,reply,log=()=>{}}){Object.assign(this,{jobs,manager,reply,log});this.users=new Map();this.closed=false}
 submit(owner,input,key,ingressIds=[]){const id=this.jobs.add(owner,input,key,ingressIds);this.wake(owner);return id}
 cancel(owner){this.jobs.cancel(owner)}
 resume(){void this.resumeQueues().catch(error=>this.log('queue.failed',{code:error.code??'RECOVERY_GATE_FAILED'}))}
 async resumeQueues(){
  const gate=this.manager.executionGate,held=await gate?.read()
  if(held&&held.account===this.manager.stateDir){
   const job=this.jobs.get(held.job)
   // bind() is persisted before any turn submission. An unbound pending job
   // therefore cannot have started through this queue.
   if(job?.state==='done'||job?.state==='pending'&&!job.thread_id||job?.state==='cancelled'&&!job.thread_id)await gate.release(held)
  }
  for(const owner of new Set(this.jobs.pending().map(j=>j.owner)))if(this.manager.owners.has(owner))this.wake(owner)
 }
 wake(owner){if(this.closed||this.users.has(owner))return;const run=this.pump(owner).catch(e=>this.log('queue.failed',{code:e.code??'WORKER_FAILED'})).finally(()=>{this.users.delete(owner);if(!this.closed&&this.jobs.pending().some(j=>j.owner===owner))queueMicrotask(()=>this.wake(owner))});this.users.set(owner,run)}
 async pump(owner){
  for(;;){if(this.closed)return;const job=this.jobs.pending().find(j=>j.owner===owner);if(!job)return;const token=this.manager.lifecycle.capture(owner),reply=(v,o)=>this.reply(owner,v,{...o,traceId:o?.traceId??(typeof job.input==='object'?job.input.traceId:undefined)})
   const gate=this.manager.executionGate,identity={account:this.manager.stateDir,job:job.id}
   let acquired=false,settled=false
   try{
    if(gate){
     let notified=false
     while(!(acquired=await gate.claim(identity,{recovery:job.state!=='pending'}))){
      if(this.closed||!token.current()){settled=true;return}
      if(!notified){await reply('本机有其他入口任务执行中或结果待核对，本任务排队等待；可发“停止”取消本条等待。');notified=true}
      await delay(250)
     }
     if(this.closed||!token.current()){settled=job.state==='pending';return}
    }
    if(job.state==='pending'){
     const input=typeof job.input==='string'?{text:job.input}:{...job.input};input.deliveryId=job.id
     while(this.manager.sessions?.get(owner)?.busy||this.manager.sessions?.get(owner)?.finishing){if(this.closed||!token.current()){settled=true;return}await delay(100)}
     if(this.closed||!token.current()){settled=true;return}
     if(input.receiptDeferred&&this.jobs.claimReceipt(job.id)&&!this.manager.state.users[owner]?.waitingAttachment){void Promise.resolve().then(()=>reply('已收到，正在处理。')).catch(()=>this.log('receipt.delivery_unconfirmed',{}))}
     const result=await this.manager.ask(owner,input,reply,24*60*60*1000,token)
     settled=['completed','failed'].includes(result?.status)||result?.status==='interrupted'&&(this.manager.state.users[owner]?.recovery?.execution==='interrupted'||this.jobs.get?.(job.id)?.state==='pending')
     if(gate&&!settled)throw Error('EXECUTION_RESULT_UNKNOWN')
     if(token.current())this.jobs.mark(job.id,'done')
    }else{await this.recover(job,reply,token);settled=this.jobs.get(job.id)?.state==='done'}
   }catch(error){if(acquired&&this.jobs.get?.(job.id)?.state==='pending')settled=true;if(this.closed)return;if(token.current()){this.jobs.mark(job.id,'uncertain');const record=this.manager.state.users[owner]??={};if(record.recovery?.execution==='running'||!record.recovery)record.recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:'unknown',delivery:'unknown'};await this.manager.save();await reply('该消息的执行或发送结果尚未确认，已保留记录；不会自动重复提交。可用 “状态” 或 /result 查询。')}}finally{if(acquired&&settled)await gate.release(identity)}
  }
 }
 async recover(...args){return recover(this,...args)}
 async recoverRemote(...args){return recoverRemote(this,...args)}
 close(){this.closed=true}
}
