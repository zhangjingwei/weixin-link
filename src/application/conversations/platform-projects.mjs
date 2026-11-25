import {randomUUID} from 'node:crypto'
import {ensurePlatformProjects} from '../../domain/conversations/platform-projects.mjs'
export function platformProjects(context,owner){
 const root=context.ensure(owner)
 return ensurePlatformProjects(context.manager.state,owner,root.entries,context.manager.state.users,context.manager.cwd)
}
export function platformProject(context,owner,id){
 const project=platformProjects(context,owner).find(p=>p.id===id)
 if(!project)throw Error('MANAGEMENT_PROJECT_NOT_FOUND')
 return project
}
export function createPlatformProject(context,owner,name,workspace){
 const projects=platformProjects(context,owner),project={id:'p_'+randomUUID(),name,roots:[workspace],workspaceVerified:true,nativeBindings:{}}
 projects.push(project)
 return project
}
export function bindPlatformConversation(context,owner,project,workspace,{name=project.name,agentKind}={}){
 const root=context.ensure(owner),key=owner+'#conversation#'+randomUUID()
 const entry={key,id:String(Math.max(0,...root.entries.map(e=>Number(e.id)||0))+1),platformProjectId:project.id,name,titleSource:'local'}
 context.manager.state.users[key]={workspace,...agentKind?{activeAgent:agentKind}:{}}
 root.entries.push(entry);context.manager.owners.add(key)
 return entry
}
