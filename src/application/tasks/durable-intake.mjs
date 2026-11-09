import {recover} from './local-recovery.mjs'
import {recoverRemote} from './remote-recovery.mjs'
import {localTaskLabel} from '../../domain/tasks/task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export class DurableIntake {
 constructor({jobs,manager,reply,log=()=>{}}){Object.assign(this,{jobs,manager,reply,log});this.users=new Map();this.closed=false}
 submit(owner,input,key,ingressIds=[]){const id=this.jobs.add(owner,input,key,ingressIds);this.wake(owner);return id}
 cancel(owner){this.jobs.cancel(owner)}
 resume(){for(const owner of new Set(this.jobs.pending().map(j=>j.owner)))if(this.manager.owners.has(owner))this.wake(owner)}
 wake(owner){if(this.closed||this.users.has(owner))return;const run=this.pump(owner).catch(e=>this.log('queue.failed',{code:e.code??'WORKER_FAILED'})).finally(()=>{this.users.delete(owner);if(!this.closed&&this.jobs.pending().some(j=>j.owner===owner))queueMicrotask(()=>this.wake(owner))});this.users.set(owner,run)}
 async pump(owner){
  for(;;){if(this.closed)return;const job=this.jobs.pending().find(j=>j.owner===owner);if(!job)return;const token=this.manager.lifecycle.capture(owner),reply=(v,o)=>this.reply(owner,v,{...o,traceId:o?.traceId??(typeof job.input==='object'?job.input.traceId:undefined)})
   try{
    if(job.state==='pending'){
     const input=typeof job.input==='string'?{text:job.input}:{...job.input};input.deliveryId=job.id
     while(this.manager.sessions?.get(owner)?.busy||this.manager.sessions?.get(owner)?.finishing){if(this.closed||!token.current())return;await delay(100)}
     if(this.closed||!token.current())return
     if(input.receiptDeferred&&this.jobs.claimReceipt(job.id)&&!this.manager.state.users[owner]?.waitingAttachment){void Promise.resolve().then(()=>reply('已收到，正在处理。')).catch(()=>this.log('receipt.delivery_unconfirmed',{}))}
     await this.manager.ask(owner,input,reply,24*60*60*1000,token)
     if(token.current())this.jobs.mark(job.id,'done')
    }else await this.recover(job,reply,token)
   }catch(error){if(this.closed)return;if(token.current()){
    if(['COMPACTION_WAIT_TIMEOUT','COMPACTION_CHECK_FAILED'].includes(error.code)){this.jobs.mark(job.id,'cancelled');await reply(error.message);continue}
    this.jobs.mark(job.id,'uncertain');const record=this.manager.state.users[owner]??={};if(record.recovery?.execution==='running'||!record.recovery)record.recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:'unknown',delivery:'unknown'};await this.manager.save();await reply('该消息的执行或发送结果尚未确认，已保留记录；不会自动重复提交。可用“状态”或“结果”查询。')}}
  }
 }
 async recover(...args){return recover(this,...args)}
 async recoverRemote(...args){return recoverRemote(this,...args)}
 close(){this.closed=true}
}
