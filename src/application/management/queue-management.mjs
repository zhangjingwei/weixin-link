import {managementWrite} from './management-writes.mjs'

export function changeQueuedTask(context,owner,caller,args){return managementWrite(context,owner,caller,'request_queue_change',args,async op=>{
 const target=context.target(owner,args.projectId),jobs=context.manager.submissions,job=jobs?.get(args.taskId)
 if(!job||job.owner!==target.key||job.state!=='pending'||job.thread_id)throw Error('MANAGEMENT_STALE_TASK')
 if(!jobs.changePending(target.key,job.id,args.action))throw Error('MANAGEMENT_STALE_TASK')
 op.status='confirmed';op.data={taskId:job.id,action:args.action,runningTaskStopped:false}
})}

export function cancelQueuedTasks(context,owner,caller,args){return managementWrite(context,owner,caller,'request_queue_cancel_all',args,async op=>{
 const target=context.target(owner,args.projectId),jobs=context.manager.submissions
 if(!jobs?.cancelPendingBatch)throw Error('MANAGEMENT_TASK_QUEUE_UNAVAILABLE')
 const count=jobs.cancelPendingBatch(target.key,args.taskIds)
 op.status='confirmed';op.data={cancelled:count,taskIds:args.taskIds,runningTaskStopped:false,futureTasksCancelled:false}
})}
