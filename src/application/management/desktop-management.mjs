import {managementWrite} from './management-writes.mjs'

export async function desktopStatus(context,owner){return {...await context.desktop?.status?.()??{enabled:false,supported:false},handoff:context.manager.state.desktopHandoff?.owner===owner?context.manager.state.desktopHandoff:null}}
export function requestDesktop(context,owner,caller,name,args){return managementWrite(context,owner,caller,name,args,async op=>{
 if(!context.desktop)throw Error('MANAGEMENT_DESKTOP_UNAVAILABLE')
 const e=context.target(owner,args.projectId),saved=context.manager.state.users[e.key]
 if(['claude','workbuddy'].includes(context.manager.agentFor?.(e.key)))throw Error('MANAGEMENT_UNSUPPORTED')
 if(e.archived||e.deleteIntent||!saved?.threadId)throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 op.threadId=saved.threadId;op.targetKey=e.key;op.workspace=context.manager.workspaceFor?.(e.key)??null
 if(name==='request_desktop_return'){
  const handoff=context.manager.state.desktopHandoff
  if(!handoff||handoff.owner!==owner||handoff.projectId!==e.id||handoff.threadId!==op.threadId)throw Error('MANAGEMENT_DESKTOP_HANDOFF_MISMATCH')
  const checked=await context.desktop.readAfterClose(op.threadId,{workspace:op.workspace,verifyWriter:true})
  if(checked?.threadId!==op.threadId)throw Error('MANAGEMENT_DESKTOP_THREAD_MISMATCH')
  if(context.manager.state.desktopHandoff!==handoff||handoff.workspace!==op.workspace)throw Error('MANAGEMENT_DESKTOP_HANDOFF_CHANGED')
  if(context.closed||!context.ready()||!context.conversations.realOwners.has(owner)||context.target(owner,args.projectId)!==e||(context.manager.state.users[e.key]?.threadId??null)!==op.threadId||(context.manager.workspaceFor?.(e.key)??null)!==op.workspace)throw Error('MANAGEMENT_STALE_TARGET')
  delete context.manager.state.desktopHandoff;op.status='confirmed';op.data={mode:'wechat',threadId:op.threadId}
 }else{
  if(context.conversations.realOwners.size!==1)throw Error('MANAGEMENT_DESKTOP_SINGLE_OWNER_REQUIRED')
  if(context.manager.state.desktopHandoff)throw Error('MANAGEMENT_DESKTOP_ALREADY_HELD')
  if([...context.manager.sessions.values()].some(s=>s.queue?.length||s.selecting))throw Error('MANAGEMENT_DESKTOP_QUEUE_BUSY')
  await context.desktop.prepare()
  context.manager.state.desktopHandoff={owner,projectId:e.id,threadId:op.threadId,workspace:op.workspace,phase:'waiting',operationId:op.id,createdAt:context.now()}
  op.status='pending';op.data={mode:'waiting_for_idle',completed:false}
 }
})}
export async function executeDesktop(context,op){
 const {manager}=context,e=context.target(op.owner,op.projectId)
 if(context.conversations.realOwners.size!==1||!context.conversations.realOwners.has(op.owner))throw Error('MANAGEMENT_DESKTOP_SINGLE_OWNER_REQUIRED')
 if(e.archived||e.deleteIntent||(manager.state.users[e.key]?.threadId??null)!==op.threadId||(manager.workspaceFor?.(e.key)??null)!==op.workspace)throw Error('MANAGEMENT_STALE_TARGET')
 if([...manager.sessions.values()].some(s=>s.busy||s.finishing||s.connecting||s.queue?.length)){await context.activate(op.caller,op.id);return false}
 if(manager.state.desktopHandoff?.operationId!==op.id||manager.state.desktopHandoff?.phase!=='waiting')throw Error('MANAGEMENT_DESKTOP_HANDOFF_CHANGED')
 await context.desktop.prepare()
 const checked=await context.desktop.readAfterClose(op.threadId,{workspace:op.workspace})
 if(op.status!=='pending'||manager.state.desktopHandoff?.operationId!==op.id||context.closed||!context.ready())throw Error('MANAGEMENT_DESKTOP_HANDOFF_CHANGED')
 if(checked?.threadId!==op.threadId||(manager.state.users[e.key]?.threadId??null)!==op.threadId||(manager.workspaceFor?.(e.key)??null)!==op.workspace)throw Error('MANAGEMENT_STALE_TARGET')
 // Fail closed across a restart or an unknown desktop launch result.
 manager.state.desktopHandoff={owner:op.owner,projectId:e.id,threadId:op.threadId,workspace:op.workspace,phase:'launching',createdAt:context.now()};op.status='executing';await manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 for(const [key,session]of manager.sessions){session.exited=true;manager.sessions.delete(key);if(manager.releaseConnection)await manager.releaseConnection(session);else{manager.detachRpc?.(session,session.rpcAttempt);session.rpc?.close()}}
 try{await context.desktop.open(op.threadId,{current:()=>!context.closed&&context.ready()});manager.state.desktopHandoff.phase='desktop';op.status='confirmed';op.data={mode:'desktop',launched:true,visibilityVerified:false}}
 catch{manager.state.desktopHandoff.phase='launch_unknown';op.status='unknown';op.detail='MANAGEMENT_DESKTOP_LAUNCH_UNCONFIRMED'}
}
