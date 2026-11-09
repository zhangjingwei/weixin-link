import {localTaskLabel,localCompletion} from '../../domain/tasks/task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export async function recoverRemote(context,job,reply,token){
  const {RemoteController}=await import('../remote-tasks/remote-controller.mjs')
  const controller=new RemoteController({root:context.manager.cwd,scope:job.thread_id}),entries=Object.entries(await controller.store.read()).filter(([,t])=>t?.kind==='official-remote-task'&&t.scope===controller.scope&&Date.parse(t.submitted_at)>=job.created)
  if(!entries.length)throw Error('LOCAL_TURN_ABANDONED')
  for(;;){if(context.closed||!token.current())return;const results=[]
   for(const [id,t] of entries){if(!t.turn_id){const r=await controller.reconcile({task:id});if(!r.turn_id)throw Error('REMOTE_SUBMISSION_UNKNOWN')}results.push(await controller.status({task:id}))}
   if(results.every(r=>['completed','failed','interrupted'].includes(r.turn_status))){context.manager.state.users[job.owner].lastTask=(job.context?.task??localTaskLabel(job.input,job.id));context.manager.state.users[job.owner].recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:results.some(r=>r.turn_status==='failed')?'failed':results.some(r=>r.turn_status==='interrupted')?'interrupted':'completed',delivery:'recovered'};context.manager.state.users[job.owner].lastReply=results.map(r=>r.host+'：'+r.turn_status+'\n'+r.answer.filter(a=>a.phase!=='commentary').map(a=>a.text).join('\n')).join('\n\n');context.manager.state.users[job.owner].lastOutput=undefined;await context.manager.save();context.jobs.mark(job.id,'done');await reply(localCompletion('远程任务状态已恢复并核对，结果已保存，可发 “结果” 查看。',(job.context?.task??localTaskLabel(job.input,job.id))));return}
   await delay(2000,undefined,{signal:token.signal}).catch(()=>{})
  }
 }
