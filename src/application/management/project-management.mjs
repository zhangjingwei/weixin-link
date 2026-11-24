import {realpath,stat} from 'node:fs/promises'
import {bindProjectSession} from '../conversations/native-projects.mjs'
import {projectFolderChoices,workspaceText} from '../conversations/workspace.mjs'
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
 const api=context.conversations.backendPort?.nativeProjects
 if(!api)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
 const project=await context.conversations.withBackend(owner,rpc=>api.create(rpc,name,path,op.id))
 const bound=bindProjectSession(context.conversations,owner,{project,workspace:path})
 op.projectId=bound.id;op.status='confirmed';op.data={projectId:bound.id,nativeProjectId:project.id,name:project.name,workspace:path,switched:false,connected:false}
})}
export function renameProject(context,owner,caller,args){return managementWrite(context,owner,caller,'rename_project',args,async op=>{
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
 const nativeId=context.manager.state.users[entry.key]?.nativeProjectId
 if(nativeId){
  const project=await context.conversations.withBackend(owner,rpc=>context.conversations.backendPort.nativeProjects.rename(rpc,nativeId,args.name.trim()))
  if(!context.manager.state.users[entry.key].threadId)entry.name=project.name
  op.status='confirmed';op.data={projectId:entry.id,nativeProjectId:nativeId,name:project.name,switched:false};return
 }
 if(!context.manager.state.users[entry.key]?.threadId){entry.name=args.name.trim();entry.titleSource='local'}
 else{
  // Existing rename verifies the official thread title. Preserve the delivery
  // callback of a disconnected target instead of routing future output to MCP.
  await context.conversations.rename(entry,args.name.trim(),(value,options)=>context.deliver(entry.key,value,options))
 }
 op.status='confirmed';op.data={projectId:entry.id,name:entry.name,switched:false}
})}

export function openProjectSession(context,owner,caller,args){return openConversation(context,owner,caller,args,'create_project_session')}

export function openConversation(context,owner,caller,args,operation='open_conversation'){return managementWrite(context,owner,caller,operation,args,async op=>{
 const conversations=context.conversations,api=conversations.backendPort?.nativeProjects
 const session=context.manager.sessions.get(caller),source=session?.taskId&&context.manager.submissions?.get(session.taskId)
 if(source?.input?.projectDispatch&&!source.input.projectDispatch.entryOrigin)throw Error('MANAGEMENT_NESTED_DISPATCH_DENIED')
 if(!api)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
 const {project,thread,workspace}=await conversations.withBackend(owner,async rpc=>{
  const project=args.nativeProjectId?await api.read(rpc,args.nativeProjectId):null
  const bound=args.threadId&&conversations.ensure(owner).entries.find(e=>context.manager.state.users[e.key]?.threadId===args.threadId)
  const session=bound&&context.manager.sessions.get(bound.key)
  const reader=session?.rpc&&!session.rpc.closed?session.rpc:rpc
  const thread=args.threadId?await conversations.backendPort.readConversation(reader,args.threadId):null
  if(args.threadId&&(thread?.id!==args.threadId||project&&thread.projectId!==project.id||thread.ephemeral||thread.parentThreadId||!['idle','notLoaded'].includes(thread.status?.type)||thread.archived||thread.path?.replaceAll('\\','/').includes('/archived_sessions/')))throw Error('MANAGEMENT_STALE_TARGET')
  if(thread&&args.workspaceToken)throw Error('MANAGEMENT_WORKSPACE_SELECTION_INVALID')
  const workspace=thread?.cwd??(args.workspaceToken?await verifyChoice(context,owner,args.workspaceToken):args.workspace??(project?.roots.length===1?project.roots[0]:null))
  if(!workspace||!thread&&project&&!project.roots.includes(workspace))throw Error('MANAGEMENT_WORKSPACE_SELECTION_REQUIRED')
  const actualProject=project??(thread?.projectId?await api.read(rpc,thread.projectId):null)
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
