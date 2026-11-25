import {managementWrite} from './management-writes.mjs'
import {requestTaskInput,reportTaskResult} from '../../domain/tasks/task-control.mjs'
function controlWrite(context,owner,caller,name,args,build){return managementWrite(context,owner,caller,name,args,async op=>{
 const entry=context.target(owner,args.projectId),session=context.manager.sessions.get(caller)
 if(entry.key!==caller||!session?.busy||session.finalReceived||session.rpc?.closed||session.taskId!==args.sourceTaskId||session.turnId!==args.turnId||session.workToken?.current()===false)throw Error('MANAGEMENT_STALE_TASK')
 const job=context.manager.submissions?.get(session.taskId)
 if(!job||job.owner!==caller||job.thread_id!==session.threadId||job.turn_id!==session.turnId)throw Error('MANAGEMENT_STALE_TASK')
 const control=build({taskId:job.id,threadId:session.threadId,turnId:session.turnId})
 // SQLite is the durable source for task control, including crash recovery.
 context.manager.submissions.context(job.id,{...job.context,control})
 session.taskControl=control
 session.waitingAttachment=control.waitingFor==='attachment'
 session.waitingUser=control.waitingFor==='answer'
 op.status='confirmed';op.data={taskId:job.id,turnId:session.turnId,...control.waitingFor?{waitingFor:control.waitingFor}:{outcome:control.outcome,evidence:'agent_report'}}
})}
export function requestTaskInputControl(context,owner,caller,args){return controlWrite(context,owner,caller,'request_task_input',args,id=>requestTaskInput(id,args.kind))}
export function reportTaskResultControl(context,owner,caller,args){return controlWrite(context,owner,caller,'report_task_result',args,id=>reportTaskResult(id,args.outcome))}
