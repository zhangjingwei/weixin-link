import {randomUUID} from 'node:crypto'
import {realpath} from 'node:fs/promises'
import {workspaceInProject} from './workspace.mjs'

// A persisted Codex thread keeps its original cwd. Resume's cwd override is
// insufficient evidence that the stored thread moved, so retain its history in
// a fork before changing the WeChat binding. The original remains recoverable.
export async function repairLegacyProjectWorkspace(context,key,rpc,thread){
 const saved=context.manager.state.users[key],projectId=saved?.nativeProjectId,api=context.backendPort?.nativeProjects
 if(!projectId||!thread?.id||!api)return false
 const project=await api.read(rpc,projectId)
 if(await workspaceInProject(thread.cwd,project)){
  if(saved.workspace!==thread.cwd){saved.workspace=thread.cwd;await context.manager.save()}
  return false
 }
 if(!['idle','notLoaded'].includes(thread.status?.type))throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(project.roots.length!==1)throw Error('MANAGEMENT_WORKSPACE_SELECTION_REQUIRED')
 const target=await realpath(project.roots[0])
 const queue=await rpc.request('thread/queue/list',{threadId:thread.id,limit:1})
 if(!Array.isArray(queue.data)||queue.data.length||queue.nextCursor)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 const result=await rpc.request('thread/fork',{threadId:thread.id,cwd:target,excludeTurns:true,deferGoalContinuation:true})
 const fork=result?.thread
 if(!fork?.id||fork.id===thread.id||!await workspaceInProject(fork.cwd,project))throw Error('CODEX_WORKSPACE_FORK_UNCONFIRMED')
 if(fork.projectId!==projectId)await api.assignThread(rpc,fork.id,projectId)
 const confirmed=await context.backendPort.readConversation(rpc,fork.id)
 if(confirmed?.id!==fork.id||!await workspaceInProject(confirmed.cwd,project)||confirmed.projectId!==projectId)throw Error('CODEX_WORKSPACE_FORK_UNCONFIRMED')
 const previous={...saved}
 saved.previous=[...new Set([...(saved.previous??[]),thread.id])].slice(-20)
 saved.threadId=fork.id;saved.workspace=target;saved.nativeProjectId=projectId;saved.workspaceMigratedFrom=thread.id
 try{await context.manager.save()}catch(error){context.manager.state.users[key]=previous;throw error}
 return true
}

// Keep the local delivery key and the exact native thread. Project names alone
// cannot establish membership, especially when several projects share a root.
export async function migrateNativeBindings(context,owner){
 const root=context.ensure(owner),api=context.backendPort?.nativeProjects
 if(!api)return
 const entries=root.entries.filter(entry=>{
  const saved=context.manager.state.users[entry.key]
  return !entry.deleted&&!entry.deleteIntent&&saved&&!Object.hasOwn(saved,'nativeProjectId')&&
   (saved.threadId||entry.titleSource==='local'&&saved.workspace)
 })
 if(!entries.length)return
 await context.withBackend(owner,async rpc=>{
  for(const entry of entries){
   const saved=context.manager.state.users[entry.key]
   let thread
   if(saved.threadId){
    try{thread=await context.backendPort.readConversation(rpc,saved.threadId)}
    catch(error){
     if(!error.definitiveRpcError||!/no rollout|not found|does not exist|thread not loaded/i.test(error.message))throw error
     context.manager.log('migration.thread_unavailable',{});continue
    }
    if(thread?.id!==saved.threadId)throw Error('CODEX_MIGRATION_THREAD_CHANGED')
   }
   const creation=context.manager.state.managementOperations?.find(op=>op.owner===owner&&op.name==='create_project'&&op.status==='confirmed'&&op.projectId===entry.id)
   const binding=Object.values(root.bindings??{}).find(b=>b?.key===entry.key&&b.command?.action==='new'&&b.command.workspace)
   const explicit=creation||binding||entry.titleSource==='local'
   let projectId=thread?.projectId??null
   if(!projectId&&explicit&&saved.workspace){
    const name=creation?.data?.name??binding?.command?.name??entry.name
    const projects=await context.backendPort.listProjects(rpc)
    const matches=projects.filter(p=>p.name===name&&p.roots.includes(saved.workspace))
    if(matches.length>1||thread&&thread.cwd!==saved.workspace){context.manager.log('migration.project_ambiguous',{});continue}
    const project=matches[0]??await api.create(rpc,name,saved.workspace,entry.key)
    if(thread)await api.assignThread(rpc,thread.id,project.id)
    projectId=project?.id??null
   }
   saved.nativeProjectId=projectId
   await context.manager.save()
  }
 })
}

export function bindProjectSession(context,owner,{project,workspace,thread}){
 const root=context.ensure(owner)
 const existing=thread&&root.entries.find(entry=>context.manager.state.users[entry.key]?.threadId===thread.id)
 if(existing){
  const session=context.manager.sessions.get(existing.key)
  if(existing.deleted||existing.archived||existing.deleteIntent||existing.archiveIntent!==undefined||context.archiveLocks?.has(existing.key)||session?.busy||session?.finishing||context.manager.workspaceFor(existing.key)!==workspace)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
  context.manager.state.users[existing.key].nativeProjectId=project?.id??null
  return existing
 }
 const key=owner+'#conversation#'+randomUUID()
 const entry={key,id:String(Math.max(0,...root.entries.map(e=>Number(e.id)||0))+1),name:thread?.name||project?.name||'当前会话',titleSource:thread?.name||project?.name?'codex':'placeholder'}
 context.manager.state.users[key]={workspace,nativeProjectId:project?.id??null,...(thread?{threadId:thread.id,hasMessages:true}:{})}
 root.entries.push(entry)
 context.manager.owners.add(key)
 return entry
}
