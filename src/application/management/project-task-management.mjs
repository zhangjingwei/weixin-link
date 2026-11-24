import {hasAttachments} from '../../domain/messages/material-association.mjs'
import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'
import {managementWrite} from './management-writes.mjs'
import {taskId} from '../../domain/messages/message-identity.mjs'
import {projectDispatchKey,validateProjectTask} from '../tasks/project-dispatch.mjs'

export function submitProjectTask(context,owner,caller,args,options={}){return managementWrite(context,owner,caller,'submit_project_task',args,op=>enqueueProjectTask(context,owner,caller,args,op,options))}

export function routeConversationRequest(context,owner,caller,args){return managementWrite(context,owner,caller,'route_conversation_request',args,async op=>{
 const session=context.manager.sessions.get(caller),job=context.manager.submissions?.get(args.sourceTaskId)
 if(!session?.busy||session.taskId!==args.sourceTaskId||job?.owner!==caller||job.input?.nativeCommand)throw Error('MANAGEMENT_SOURCE_TASK_CHANGED')
 const input=typeof job.input==='string'?{text:job.input}:job.input
 if(input.projectDispatch&&!input.projectDispatch.entryOrigin)throw Error('MANAGEMENT_NESTED_DISPATCH_DENIED')
 if(context.operations.some(other=>other!==op&&other.owner===owner&&other.sourceTaskId===job.id&&['executing','queued','unknown','confirmed'].includes(other.status)))throw Error('MANAGEMENT_SOURCE_ALREADY_ROUTED')
 op.sourceTaskId=job.id
 const target=context.target(owner,args.projectId)
 if(target.key===caller)throw Error('MANAGEMENT_ALREADY_IN_PROJECT')
 if(!args.threadId||context.manager.state.users[target.key]?.threadId!==args.threadId)throw Error('MANAGEMENT_STALE_TARGET')
 await context.manager.save()
 let preparedInput=Object.fromEntries(['text','attachments','images','audios','references'].filter(key=>input[key]!==undefined).map(key=>[key,structuredClone(input[key])]))
 if(hasAttachments(preparedInput)){
  if(!context.prepareHandoff)throw Error('MANAGEMENT_ATTACHMENT_HANDOFF_UNAVAILABLE')
  preparedInput=await context.prepareHandoff({sourceKey:caller,targetKey:target.key,ingressId:job.id,input:preparedInput})
 }
 if(context.manager.sessions.get(caller)!==session||!session.busy||session.taskId!==job.id)throw Error('MANAGEMENT_SOURCE_TASK_CHANGED')
 if(args.agreedPlan)preparedInput.agreedPlan=args.agreedPlan
 await enqueueProjectTask(context,owner,caller,{projectId:args.projectId,text:preparedInput.text??input.text??'',requestId:args.requestId},op,{preparedInput,preserveText:true})
})}

async function enqueueProjectTask(context,owner,caller,args,op,{allowCurrent=false,title,dependencies=[],preparedInput,preserveText=false}={}){
 if(typeof context.enqueueTask!=='function'||!context.manager.submissions)throw Error('MANAGEMENT_TASK_QUEUE_UNAVAILABLE')
 const target=context.target(owner,args.projectId),session=context.manager.sessions.get(caller)
 if(target.key===caller&&!allowCurrent)throw Error('MANAGEMENT_ALREADY_IN_PROJECT')
 const dispatch=session?.taskId?context.manager.submissions.get(session.taskId)?.input?.projectDispatch:null
 if(!allowCurrent&&dispatch&&!dispatch.entryOrigin)throw Error('MANAGEMENT_NESTED_DISPATCH_DENIED')
 if(context.manager.submissions.pending().filter(job=>job.owner===target.key&&job.state==='pending').length>=5)throw Error('MANAGEMENT_PROJECT_QUEUE_FULL')
 const key=projectDispatchKey(op.id),id=taskId(target.key,key)
 if(dependencies.length>5||dependencies.some(id=>{const job=context.manager.submissions.get(id),entry=job&&context.conversations.entry(job.owner);return !job||entry?.owner!==owner}))throw Error('MANAGEMENT_DEPENDENCY_INVALID')
 const input={...preparedInput,text:!preserveText&&preparedInput?.attachments?.length?args.text+'\n\n当前消息附件接入资料（保留原接收范围与解析状态）：\n'+preparedInput.text:args.text,...dependencies.length?{dependencies}:{},projectDispatch:{version:1,title:taskDisplayTitle(args.text,title),...allowCurrent&&target.key===caller?{entryOrigin:true}:{},operationId:op.id,originKey:caller,projectId:target.id,threadId:context.manager.state.users[target.key]?.threadId??null,workspace:context.manager.workspaceFor(target.key)}}
 try{validateProjectTask(context,{id,owner:target.key,input})}catch(error){throw Error(error.message==='PROJECT_TASK_TARGET_CHANGED'?'MANAGEMENT_STALE_TARGET':'MANAGEMENT_TARGET_UNAVAILABLE')}
 // Journal the expected queue identity before insertion; a crash cannot cause a
 // fresh request ID or a blind replay of the original model execution.
 op.data={taskId:id,title:input.projectDispatch.title,projectId:target.id,name:target.name,switched:false,returnTo:'current_entry'}
 await context.manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 const submitted=await context.enqueueTask(target.key,input,key)
 if(submitted!==id)throw Error('PROJECT_TASK_QUEUE_UNCONFIRMED')
 op.status='queued'
}
