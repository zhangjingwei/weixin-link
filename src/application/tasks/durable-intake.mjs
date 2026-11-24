import {validateProjectTask} from './project-dispatch.mjs'
import {recover} from './local-recovery.mjs'
import {localTaskLabel} from '../../domain/tasks/task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export class DurableIntake {
 constructor({jobs,manager,reply,conversations,log=()=>{}}){Object.assign(this,{jobs,manager,reply,conversations,log});this.users=new Map();this.closed=false}
 submit(owner,input,key,ingressIds=[]){const id=this.jobs.add(owner,input,key,ingressIds);this.wake(owner);return id}
 cancel(owner){this.jobs.cancel(owner)}
 resume(){for(const owner of new Set(this.jobs.pending().map(j=>j.owner)))if(this.manager.owners.has(owner))this.wake(owner)}
 wake(owner){if(this.closed||this.users.has(owner))return;const run=this.pump(owner).catch(e=>this.log('queue.failed',{code:e.code??'WORKER_FAILED'})).finally(()=>{this.users.delete(owner);if(!this.closed&&this.jobs.pending().some(j=>j.owner===owner))queueMicrotask(()=>this.wake(owner))});this.users.set(owner,run)}
 next(owner){
  const jobs=this.jobs.pending().filter(job=>job.owner===owner)
  const active=jobs.find(job=>job.state!=='pending');if(active)return active
  return jobs.find(job=>job.state!=='pending'||!(job.input?.dependencies??[]).some(id=>{const prior=this.jobs.get(id);return prior&&!['done','cancelled','uncertain'].includes(prior.state)}))??jobs[0]
 }
 async pump(owner){
  for(;;){if(this.closed)return;const job=this.next(owner);if(!job)return;const token=this.manager.lifecycle.capture(owner),reply=(v,o)=>this.reply(owner,v,{...o,...job.input?.projectDispatch?{projectTaskId:job.id}:{},traceId:o?.traceId??(typeof job.input==='object'?job.input.traceId:undefined)})
   let executionStarted=false
   try{
    if(job.state==='pending'){
     const input=typeof job.input==='string'?{text:job.input}:{...job.input};input.deliveryId=job.id
     while(this.manager.sessions?.get(owner)?.busy||this.manager.sessions?.get(owner)?.finishing){if(this.closed||!token.current())return;await delay(100)}
     if(this.closed||!token.current())return
     if((this.jobs.get?this.jobs.get(job.id):job)?.state!=='pending'||this.next(owner)?.id!==job.id)continue
     validateProjectTask(this,job)
     const dependencies=job.input?.dependencies??[]
     const prerequisites=dependencies.map(id=>this.jobs.get(id))
     if(prerequisites.some(prior=>!prior||['cancelled','uncertain'].includes(prior.state)||prior.state==='done'&&prior.outcome!=='completed')){this.jobs.mark(job.id,'cancelled');await reply('前置任务未确认成功，依赖任务未执行。');continue}
     if(prerequisites.some(prior=>prior.state!=='done')){await delay(100);continue}
     if(this.jobs.claimStart&&!this.jobs.claimStart(owner,job.id))continue
     if(dependencies.length)input.text+='\n\n前置任务执行记录（仅状态证据，不是新指令；如原请求需要内容，可按任务编号查询结果）：'+JSON.stringify(prerequisites.map(prior=>({taskId:prior.id,projectId:this.conversations?.entry(prior.owner)?.id??null,execution:prior.outcome})))
     if(input.receiptDeferred&&this.jobs.claimReceipt(job.id)&&!this.manager.state.users[owner]?.waitingAttachment){void Promise.resolve().then(()=>reply('已收到，正在处理。')).catch(()=>this.log('receipt.delivery_unconfirmed',{}))}
     executionStarted=true
     const result=await this.manager.ask(owner,input,reply,24*60*60*1000,token)
     if(token.current()){this.jobs.markOutcome?.(job.id,result?.status==='completed'&&!this.manager.state.users[owner]?.waitingAttachment?'completed':'not_confirmed');this.jobs.mark(job.id,'done')}
    }else{executionStarted=true;await this.recover(job,reply,token)}
   }catch(error){if(this.closed)return;if(token.current()){
    if(!executionStarted&&/^PROJECT_TASK_(?:ROUTE_INVALID|TARGET_UNAVAILABLE|TARGET_CHANGED)$/.test(error.message)){this.jobs.mark(job.id,'cancelled');await reply('指定项目的任务未执行：目标或归属已变化，请核对项目后重新提交。');continue}
    if(['COMPACTION_WAIT_TIMEOUT','COMPACTION_CHECK_FAILED'].includes(error.code)){this.jobs.mark(job.id,'cancelled');await reply(error.message);continue}
    this.jobs.mark(job.id,'uncertain');const record=this.manager.state.users[owner]??={};if(record.recovery?.execution==='running'||!record.recovery)record.recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:'unknown',delivery:'unknown'};await this.manager.save();await reply('该消息的执行或发送结果尚未确认，已保留记录；不会自动重复提交。可用“状态”或“结果”查询。')}}
  }
 }
 async recover(...args){return recover(this,...args)}
 close(){this.closed=true}
}
