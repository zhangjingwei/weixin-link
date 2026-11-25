import {platformProject} from '../conversations/platform-projects.mjs'
import {managementWrite} from './management-writes.mjs'
import {conversationRepository} from '../../infrastructure/agents/conversation-repository.mjs'
import {hasAttachments,currentMaterials} from '../../domain/messages/material-association.mjs'
import {workspaceInProject} from '../conversations/workspace.mjs'

export async function conversationContext(context,owner,caller){
 const entry=context.conversations.entry(caller),saved=context.manager.state.users[caller]??{},session=context.manager.sessions.get(caller)
 const job=session?.taskId&&context.manager.submissions?.get(session.taskId)
 const dispatch=job?.input?.projectDispatch
 const workspace=context.manager.workspaceFor(caller)
 const local=entry.platformProjectId?platformProject(context.conversations,owner,entry.platformProjectId):null
 const projectWorkspace=local?.workspaceVerified?(await workspaceInProject(workspace,local)?'matches':'mismatch'):'unverified'
 return {projectId:entry.id,platformProjectId:entry.platformProjectId??null,turnId:session?.turnId??null,taskId:session?.traceId??null,threadId:saved.threadId??null,nativeProjectId:saved.nativeProjectId??null,name:entry.name,workspace,projectWorkspace,sourceTaskId:job?.id??null,alreadyRouted:!!dispatch&&!dispatch.entryOrigin,materials:job?currentMaterials(job.input,job.id):[],hasAttachments:hasAttachments(job?.input),scope:'当前执行会话和本轮持久任务，不代表微信导航选择或项目根目录'}
}

export async function repositoryContext(context,owner,args){
 if(context.conversations.realOwners.size!==1)throw Error('MANAGEMENT_PERSONAL_CATALOG_REQUIRED')
 const inspect=context.inspectRepository??conversationRepository
 return context.conversations.withBackend(owner,async rpc=>{
  const thread=await context.conversations.backendPort.readConversation(rpc,args.threadId)
  if(thread?.id!==args.threadId||thread.ephemeral||thread.parentThreadId)throw Error('MANAGEMENT_STALE_TARGET')
  const repository=await inspect(thread.cwd)
  if(!repository)return {threadId:thread.id,repository:null,workspaceToken:null}
  const token=context.sign({kind:'conversation-repository',owner,threadId:thread.id,cwd:thread.cwd,...repository,expires:context.now()+300000})
  return {threadId:thread.id,nativeProjectId:thread.projectId??null,repository,workspaceToken:token,expiresInSeconds:300}
 })
}

// The model chooses the grouping. This operation only verifies exact repository
// identity, preserving explicit existing memberships and each worktree's cwd.
export function associateRepositoryConversations(context,owner,caller,args){return managementWrite(context,owner,caller,'associate_repository_conversations',args,async op=>{
 if(context.conversations.realOwners.size!==1)throw Error('MANAGEMENT_PERSONAL_CATALOG_REQUIRED')
 const inspect=context.inspectRepository??conversationRepository,proof=context.credential(args.workspaceToken,'conversation-repository',owner)
 const api=context.conversations.backendPort?.nativeProjects
 if(!api?.assignThread)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
 let mutationAttempted=false
 let result
 try{result=await context.conversations.withBackend(owner,async rpc=>{
  const anchor=await context.conversations.backendPort.readConversation(rpc,proof.threadId)
  const original=anchor?.id===proof.threadId&&anchor.cwd===proof.cwd?await inspect(anchor.cwd):null
  if(!original||original.root!==proof.root||original.commonDir!==proof.commonDir)throw Error('MANAGEMENT_REPOSITORY_CHANGED')
  const threads=[]
  for(const id of args.threadIds){
   const thread=await context.conversations.backendPort.readConversation(rpc,id)
   if(thread?.id!==id||thread.ephemeral||thread.parentThreadId||thread.archived||thread.path?.replaceAll('\\','/').includes('/archived_sessions/')||!['idle','notLoaded'].includes(thread.status?.type))throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
   const bound=context.entries(owner).find(e=>context.manager.state.users[e.key]?.threadId===id)
   const session=bound&&context.manager.sessions.get(bound.key)
   if(bound&&(bound.archived||bound.archiveIntent!==undefined||context.conversations.archiveLocks?.has(bound.key))||session?.busy||session?.finishing)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
   const repository=await inspect(thread.cwd)
   if(!repository||repository.commonDir!==proof.commonDir)throw Error('MANAGEMENT_REPOSITORY_MISMATCH')
   if(thread.projectId&&thread.projectId!==args.nativeProjectId)throw Error('MANAGEMENT_EXISTING_PROJECT_MEMBERSHIP')
   threads.push({thread,repository})
  }
  const roots=[...new Set(threads.map(item=>item.repository.root))]
  let project
  if(args.nativeProjectId){
   project=await api.read(rpc,args.nativeProjectId)
   for(const root of project.roots){
    const repository=await inspect(root)
    if(!repository||repository.commonDir!==proof.commonDir)throw Error('MANAGEMENT_PROJECT_ROOT_MISMATCH')
   }
   if(!roots.every(root=>project.roots.includes(root))){
    if(!api.includeRoots)throw Error('MANAGEMENT_PROJECT_ROOT_MISMATCH')
    mutationAttempted=true
    project=await api.includeRoots(rpc,project.id,[...new Set([...project.roots,...roots])])
   }
  }else{
   if(!args.name?.trim())throw Error('MANAGEMENT_PROJECT_NAME_REQUIRED')
   if(!api.createGroup)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
   mutationAttempted=true
   project=await api.createGroup(rpc,args.name.trim(),roots,op.id)
  }
  op.data={nativeProjectId:project.id,threadIds:args.threadIds,switched:false};await context.manager.save()
  for(const {thread} of threads){
   const current=await context.conversations.backendPort.readConversation(rpc,thread.id)
   if(current?.id!==thread.id||current.cwd!==thread.cwd||current.projectId!==thread.projectId||!['idle','notLoaded'].includes(current.status?.type)||current.archived)throw Error('MANAGEMENT_STALE_TARGET')
  }
  for(const {thread} of threads)if(thread.projectId!==project.id){mutationAttempted=true;await api.assignThread(rpc,thread.id,project.id)}
  return project
 })}catch(error){if(mutationAttempted)throw Error('CODEX_PROJECT_ASSOCIATION_UNCONFIRMED');throw error}
 for(const entry of context.entries(owner)){
  const saved=context.manager.state.users[entry.key]
  if(saved&&args.threadIds.includes(saved.threadId))saved.nativeProjectId=result.id
 }
 op.status='confirmed'
})}
