import {taskId} from '../../domain/messages/message-identity.mjs'

export const projectDispatchKey=id=>'management-project-task:'+id

// Routing belongs to a durable job, never to the current active selection or a
// model-provided recipient. Retain it with the original queue record on restart.
export function projectTaskRoute({manager,conversations},job){
 const route=job?.input?.projectDispatch
 if(!route)return null
 const target=conversations?.entry(job.owner),origin=conversations?.entry(route.originKey)
 if(route.version!==1||! /^[0-9a-f-]{36}$/.test(route.operationId??'')||job.id!==taskId(job.owner,projectDispatchKey(route.operationId))||!target||!origin||target.owner!==origin.owner||!conversations.realOwners.has(target.owner)||route.projectId!==target.id)throw Error('PROJECT_TASK_ROUTE_INVALID')
 if(route.entryOrigin&&target.key!==origin.key)throw Error('PROJECT_TASK_ROUTE_INVALID')
 return {target,origin,route}
}

export function validateProjectTask(context,job){
 const binding=projectTaskRoute(context,job)
 if(!binding)return
 const {target,route}=binding,{manager,conversations}=context
 if(target.deleted||target.deleteIntent||target.archived||target.archiveIntent!==undefined||target.archiveSync==='missing'||conversations.archiveLocks?.has(target.key))throw Error('PROJECT_TASK_TARGET_UNAVAILABLE')
 if(route.threadId&&(manager.state.users[target.key]?.threadId??null)!==route.threadId||manager.workspaceFor(target.key)!==route.workspace)throw Error('PROJECT_TASK_TARGET_CHANGED')
}
