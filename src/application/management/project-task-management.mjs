import {managementWrite} from './management-writes.mjs'
import {taskId} from '../../domain/messages/message-identity.mjs'
import {projectDispatchKey,validateProjectTask} from '../tasks/project-dispatch.mjs'

export function submitProjectTask(context,owner,caller,args){return managementWrite(context,owner,caller,'submit_project_task',args,async op=>{
 if(typeof context.enqueueTask!=='function'||!context.manager.submissions)throw Error('MANAGEMENT_TASK_QUEUE_UNAVAILABLE')
 const target=context.target(owner,args.projectId),session=context.manager.sessions.get(caller)
 if(target.key===caller)throw Error('MANAGEMENT_ALREADY_IN_PROJECT')
 if(session?.taskId&&context.manager.submissions.get(session.taskId)?.input?.projectDispatch)throw Error('MANAGEMENT_NESTED_DISPATCH_DENIED')
 if(context.manager.submissions.pending().filter(job=>job.owner===target.key&&job.state==='pending').length>=5)throw Error('MANAGEMENT_PROJECT_QUEUE_FULL')
 const key=projectDispatchKey(op.id),id=taskId(target.key,key)
 const input={text:args.text,projectDispatch:{version:1,operationId:op.id,originKey:caller,projectId:target.id,threadId:context.manager.state.users[target.key]?.threadId??null,workspace:context.manager.workspaceFor(target.key)}}
 try{validateProjectTask(context,{id,owner:target.key,input})}catch(error){throw Error(error.message==='PROJECT_TASK_TARGET_CHANGED'?'MANAGEMENT_STALE_TARGET':'MANAGEMENT_TARGET_UNAVAILABLE')}
 // Journal the expected queue identity before insertion; a crash cannot cause a
 // fresh request ID or a blind replay of the original model execution.
 op.data={taskId:id,projectId:target.id,name:context.conversations.displayName(owner,target),switched:false,returnTo:'current_entry'}
 await context.manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 const submitted=await context.enqueueTask(target.key,input,key)
 if(submitted!==id)throw Error('PROJECT_TASK_QUEUE_UNCONFIRMED')
 op.status='queued'
})}
