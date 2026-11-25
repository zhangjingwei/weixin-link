import {randomUUID} from 'node:crypto'

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
