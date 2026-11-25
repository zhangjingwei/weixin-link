import {platformProject,platformProjects,createPlatformProject,bindPlatformConversation} from '../conversations/platform-projects.mjs'
import {realpath,stat} from 'node:fs/promises'
import {bindProjectSession} from '../conversations/native-projects.mjs'
import {projectFolderChoices,workspaceText,workspaceInProject} from '../conversations/workspace.mjs'
import {managementWrite} from './management-writes.mjs'

export async function workspaceChoices(context,owner,args){
 const e=context.target(owner,args.projectId),root=await realpath(workspaceText(context.conversations,e.key)),choices=await projectFolderChoices(context.conversations,e.key)
 const items=[]
 for(const choice of choices){const path=await realpath(choice.path),info=await stat(path);items.push({name:choice.name,path,workspaceToken:context.sign({kind:'workspace',owner,sourceId:e.id,root,path,dev:String(info.dev),ino:String(info.ino),expires:context.now()+300000})})}
 return {items,hasMore:!!choices.more,expiresInSeconds:300}
}
export async function verifyChoice(context,owner,token){
 const value=context.credential(token,'workspace',owner),source=context.target(owner,value.sourceId)
 let root,path,info
 try{root=await realpath(workspaceText(context.conversations,source.key));path=await realpath(value.path);info=await stat(path)}catch{throw Error('MANAGEMENT_WORKSPACE_CHANGED')}
 if(root!==value.root||path!==value.path||!info.isDirectory()||String(info.dev)!==value.dev||String(info.ino)!==value.ino)throw Error('MANAGEMENT_WORKSPACE_CHANGED')
 const choices=await projectFolderChoices(context.conversations,source.key)
 if(!choices.some(choice=>choice.path===path))throw Error('MANAGEMENT_WORKSPACE_CHANGED')
 return path
}
export function createProject(context,owner,caller,args){return managementWrite(context,owner,caller,'create_project',args,async op=>{
 const path=await verifyChoice(context,owner,args.workspaceToken)
 const name=args.name.trim()
 const project=createPlatformProject(context.conversations,owner,name,path)
 const bound=bindPlatformConversation(context.conversations,owner,project,path)
 op.projectId=bound.id;op.status='confirmed';op.data={projectId:bound.id,platformProjectId:project.id,nativeProjectId:null,name:project.name,workspace:path,switched:false,connected:false}
})}
export function renameProject(context,owner,caller,args){return managementWrite(context,owner,caller,'rename_project',args,async op=>{
 const local=platformProjects(context.conversations,owner).find(p=>p.id===args.projectId)
 if(local){local.name=args.name.trim();op.status='confirmed';op.data={platformProjectId:local.id,name:local.name,switched:false};return}
 const api=context.conversations.backendPort?.nativeProjects
 // Native IDs from project/list can be used before any WeChat session exists.
 if(api&&!context.entries(owner).some(e=>e.id===args.projectId)){
  const project=await context.conversations.withBackend(owner,async rpc=>{
   const target=await api.read(rpc,args.projectId)
   return api.rename(rpc,target.id,args.name.trim())
  })
  op.status='confirmed';op.data={nativeProjectId:project.id,name:project.name,switched:false};return
 }
 const entry=context.target(owner,args.projectId)
 if(entry.archived||entry.archiveSync==='missing'||context.conversations.archiveLocks?.has(entry.key))throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 const project=platformProjects(context.conversations,owner).find(p=>p.id===entry.platformProjectId)
 if(project)project.name=args.name.trim()
 entry.name=args.name.trim();entry.titleSource='local'
 op.status='confirmed';op.data={projectId:entry.id,name:entry.name,switched:false}
})}

export function openProjectSession(context,owner,caller,args){return openConversation(context,owner,caller,args,'create_project_session')}

export function openConversation(context,owner,caller,args,operation='open_conversation'){return managementWrite(context,owner,caller,operation,args,async op=>{
 const conversations=context.conversations,api=conversations.backendPort?.nativeProjects
 const session=context.manager.sessions.get(caller),source=session?.taskId&&context.manager.submissions?.get(session.taskId)
 if(source?.input?.projectDispatch&&!source.input.projectDispatch.entryOrigin)throw Error('MANAGEMENT_NESTED_DISPATCH_DENIED')
 if(!args.nativeProjectId&&!args.threadId){
  let project=args.platformProjectId?platformProject(conversations,owner,args.platformProjectId):null
  const workspace=args.workspaceToken?await verifyChoice(context,owner,args.workspaceToken):project?.roots.length===1?project.roots[0]:null
  if(!workspace)throw Error('MANAGEMENT_WORKSPACE_SELECTION_REQUIRED')
  if(project&&(!project.workspaceVerified||!await workspaceInProject(workspace,project)))throw Error('MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
  project??=createPlatformProject(conversations,owner,'独立项目',workspace)
  const entry=bindPlatformConversation(conversations,owner,project,workspace)
  op.projectId=entry.id;op.status='confirmed';op.data={projectId:entry.id,platformProjectId:project.id,nativeProjectId:null,threadId:null,switched:false,connected:false}
  return
 }
 if(args.platformProjectId)throw Error('MANAGEMENT_NATIVE_AND_LOCAL_PROJECT_CONFLICT')
 if(!api)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
 const {project,thread,workspace}=await conversations.withBackend(owner,async rpc=>{
  const project=args.nativeProjectId?await api.read(rpc,args.nativeProjectId):null
  const bound=args.threadId&&conversations.ensure(owner).entries.find(e=>context.manager.state.users[e.key]?.threadId===args.threadId)
  const session=bound&&context.manager.sessions.get(bound.key)
  const reader=session?.rpc&&!session.rpc.closed?session.rpc:rpc
  const thread=args.threadId?await conversations.backendPort.readConversation(reader,args.threadId):null
  if(args.threadId&&(thread?.id!==args.threadId||project&&thread.projectId!==project.id||thread.ephemeral||thread.parentThreadId&&!bound||!['idle','notLoaded'].includes(thread.status?.type)||thread.archived||thread.path?.replaceAll('\\','/').includes('/archived_sessions/')))throw Error('MANAGEMENT_STALE_TARGET')
  if(thread&&args.workspaceToken)throw Error('MANAGEMENT_WORKSPACE_SELECTION_INVALID')
  const workspace=thread?.cwd??(args.workspaceToken?await verifyChoice(context,owner,args.workspaceToken):args.workspace??(project?.roots.length===1?project.roots[0]:null))
  if(!workspace||!thread&&project&&!project.roots.includes(workspace))throw Error('MANAGEMENT_WORKSPACE_SELECTION_REQUIRED')
  const actualProject=project??(thread?.projectId?await api.read(rpc,thread.projectId):null)
  if(actualProject&&!await workspaceInProject(workspace,actualProject))throw Error('MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
  return {project:actualProject,thread,workspace}
 })
 const empty=conversations.ensure(owner).entries.find(e=>{
  const saved=context.manager.state.users[e.key]
  return !e.archived&&!e.deleted&&!e.deleteIntent&&!context.manager.sessions.has(e.key)&&saved?.nativeProjectId===(project?.id??null)&&saved.workspace===workspace&&!saved.threadId
 })
 const entry=(operation==='create_project_session'&&!thread&&empty)||bindProjectSession(conversations,owner,{project,thread,workspace})
 op.projectId=entry.id
 await context.manager.save()
 if(!thread||operation==='open_conversation'){
  const session=await context.manager.connect(entry.key,(value,options)=>context.deliver(entry.key,value,options))
  if(!session.threadId||thread&&session.threadId!==thread.id)throw Error('CODEX_THREAD_UNCONFIRMED')
 }
 op.status='confirmed';op.data={projectId:entry.id,nativeProjectId:project?.id??null,threadId:context.manager.state.users[entry.key].threadId,switched:false}
})}

export function confirmProjectWorkspace(context,owner,caller,args){return managementWrite(context,owner,caller,'request_project_workspace',args,async op=>{
 const project=platformProject(context.conversations,owner,args.platformProjectId),path=await verifyChoice(context,owner,args.workspaceToken)
 const entries=context.entries(owner).filter(e=>e.platformProjectId===project.id)
 for(const entry of entries){
  const session=context.manager.sessions.get(entry.key)
  if(session?.busy&&entry.key!==caller||session?.connecting||session?.finishing||context.manager.submissions?.uncertainCount?.(entry.key))throw Error('MANAGEMENT_TARGET_BUSY')
  if(!await workspaceInProject(context.manager.workspaceFor(entry.key),{roots:[path]}))throw Error('MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
 }
 project.roots=[path];project.workspaceVerified=true
 op.status='confirmed';op.data={platformProjectId:project.id,workspace:path,changedConversationDirectories:false}
})}
