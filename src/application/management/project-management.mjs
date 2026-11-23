import {realpath,stat} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {projectFolderChoices,workspaceText,bindNewWorkspace} from '../conversations/workspace.mjs'
import {managementWrite} from './management-writes.mjs'

export async function workspaceChoices(context,owner,args){
 const e=context.target(owner,args.projectId),root=await realpath(workspaceText(context.conversations,e.key)),choices=await projectFolderChoices(context.conversations,e.key)
 const items=[]
 for(const choice of choices){const path=await realpath(choice.path),info=await stat(path);items.push({name:choice.name,path,workspaceToken:context.sign({kind:'workspace',owner,sourceId:e.id,root,path,dev:String(info.dev),ino:String(info.ino),expires:context.now()+300000})})}
 return {items,hasMore:!!choices.more,expiresInSeconds:300}
}
async function verifyChoice(context,owner,token){
 const value=context.credential(token,'workspace',owner),source=context.target(owner,value.sourceId)
 let root,path,info
 try{root=await realpath(workspaceText(context.conversations,source.key));path=await realpath(value.path);info=await stat(path)}catch{throw Error('MANAGEMENT_WORKSPACE_CHANGED')}
 if(root!==value.root||path!==value.path||!info.isDirectory()||String(info.dev)!==value.dev||String(info.ino)!==value.ino)throw Error('MANAGEMENT_WORKSPACE_CHANGED')
 const choices=await projectFolderChoices(context.conversations,source.key)
 if(!choices.some(choice=>choice.path===path))throw Error('MANAGEMENT_WORKSPACE_CHANGED')
 return path
}
export function createProject(context,owner,caller,args){return managementWrite(context,owner,caller,'create_project',args,async op=>{
 const path=await verifyChoice(context,owner,args.workspaceToken),root=context.conversations.root[owner]
 const entry={id:String(Math.max(0,...root.entries.map(e=>Number(e.id)||0))+1),key:owner+'#conversation#'+randomUUID(),name:args.name.trim(),titleSource:'local'}
 // bindNewWorkspace is the existing application use case; it validates canonical
 // directories and refuses migration of an already connected conversation.
 const canonical=await bindNewWorkspace(context.conversations,entry.key,path,{prepareOnly:true})
 if(canonical!==path)throw Error('MANAGEMENT_WORKSPACE_CHANGED')
 context.manager.state.users[entry.key]={workspace:canonical}
 root.entries.push(entry);context.manager.owners.add(entry.key);op.projectId=entry.id;op.status='confirmed';op.data={projectId:entry.id,name:entry.name,workspace:path,switched:false,connected:false}
})}
export function renameProject(context,owner,caller,args){return managementWrite(context,owner,caller,'rename_project',args,async op=>{
 const entry=context.target(owner,args.projectId)
 if(entry.archived||entry.archiveSync==='missing'||context.conversations.archiveLocks?.has(entry.key))throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 if(!context.manager.state.users[entry.key]?.threadId){entry.name=args.name.trim();entry.titleSource='local'}
 else{
  // Existing rename verifies the official thread title. Preserve the delivery
  // callback of a disconnected target instead of routing future output to MCP.
  await context.conversations.rename(entry,args.name.trim(),(value,options)=>context.deliver(entry.key,value,options))
 }
 op.status='confirmed';op.data={projectId:entry.id,name:entry.name,switched:false}
})}
