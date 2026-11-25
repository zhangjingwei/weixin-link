import {managementWrite} from './management-writes.mjs'
import {verifyChoice} from './project-management.mjs'
import {workspaceInProject} from '../conversations/workspace.mjs'

export const nativeControlMethods={
 get_thread_goal:'thread/goal/get',request_goal_update:'thread/goal/set',request_goal_clear:'thread/goal/clear',
 get_account_usage:'account/usage/read',get_account_limits:'account/rateLimits/read',
 list_thread_sections:'threadSection/list',create_thread_section:'threadSection/create',
 request_section_rename:'threadSection/update',request_section_delete:'threadSection/delete',
 request_thread_move:'thread/section/move',request_project_move:'project/move',
 request_project_delete:'project/delete',request_project_import:'project/import',
 request_thread_revert:'thread/revert',list_thread_queue:'thread/queue/list',
 request_queue_add:'thread/queue/add',request_queue_edit:'thread/queue/update',
 request_queue_remove:'thread/queue/delete',request_queue_reorder:'thread/queue/reorder',
 request_queue_start:'thread/queue/start',
}
export function hasNativeControl(name){return Object.hasOwn(nativeControlMethods,name)}
export function nativeControlParams(name,args){
 const {requestId,workspaceToken,text,...params}=args
 if(name==='request_thread_move')params.sectionId??=null
 if(name==='request_goal_update'||name==='request_goal_clear')params.origin='user'
 if(text!==undefined)params.input=[{type:'text',text}]
 if(name==='request_queue_add')params.clientUserMessageId=requestId
 if(name==='request_project_import')params.idempotencyKey=requestId
 return params
}
export async function nativeControl(context,owner,caller,name,args){
 const method=nativeControlMethods[name],{requestId,workspaceToken}=args,params=nativeControlParams(name,args)
 const threadId=params.threadId
 // Persisted non-Codex identities remain non-Codex after idle release/restart.
 if(threadId&&Object.entries(context.manager.state?.users??{}).some(([key,saved])=>context.conversations.recipient(key)===owner&&['claude','workbuddy'].some(kind=>saved.nativeSessions?.[kind]?.threadId===threadId||((saved.activeAgent??saved.agentKind)===kind&&saved.threadId===threadId))))throw Error('MANAGEMENT_UNSUPPORTED')
 // Native project and section IDs refer to the personal installation's shared catalog.
 if(context.conversations.realOwners.size!==1)throw Error('MANAGEMENT_PERSONAL_CATALOG_REQUIRED')
 const run=async()=>{
  if(name==='request_project_import'){
   const root=await verifyChoice(context,owner,workspaceToken)
   params.roots=[{path:root}]
   for(const id of params.threads??[]){
    const thread=await context.conversations.withBackend(owner,rpc=>context.conversations.backendPort.readConversation(rpc,id))
    if(thread?.id!==id||!await workspaceInProject(thread.cwd,{roots:[root]}))throw Error('MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
   }
  }
  if(name==='request_thread_revert'&&[...context.manager.sessions.values()].some(s=>s.threadId===threadId&&(s.busy||s.finishing)))throw Error('MANAGEMENT_THREAD_BUSY')
  const session=threadId&&[...context.manager.sessions.values()].find(s=>s.threadId===threadId&&!s.rpc?.closed&&context.conversations.recipient(s.userId)===owner)
  if(session&&(['claude','workbuddy'].includes(context.manager.agentFor?.(session.userId))||['claude','workbuddy'].includes(session.rpc?.agentKind)))throw Error('MANAGEMENT_UNSUPPORTED')
  const call=rpc=>rpc.request(method,params)
  let result
  try{result=session?.rpc?await call(session.rpc):await context.conversations.withBackend(owner,call)}
  catch(error){
   if(error.definitiveRpcError)throw Error('MANAGEMENT_NATIVE_REQUEST_REJECTED')
   throw error
  }
  if(name==='request_project_delete'||name==='request_project_import'){
   for(const entry of context.entries(owner)){
    const saved=context.manager.state.users[entry.key]
    if(!saved)continue
    if(name==='request_project_delete'&&saved.nativeProjectId===params.projectId)saved.nativeProjectId=null
    if(name==='request_project_import'&&params.threads?.includes(saved.threadId)&&result.project?.id)saved.nativeProjectId=result.project.id
   }
  }
  if(name==='get_account_limits'){
   const {rateLimits,rateLimitsByLimitId,ordinaryUsageAllowed}=result
   return {rateLimits,rateLimitsByLimitId,ordinaryUsageAllowed}
  }
  if(name==='list_thread_queue')return {items:result.data.map(item=>({id:item.id,title:item.input?.find(i=>i.type==='text')?.text?.slice(0,120)??'附件'})),nextCursor:result.nextCursor}
  if(name==='request_queue_remove'&&!result.deleted)throw Error('MANAGEMENT_STALE_TASK')
  if(result.queuedSubmission)return {queuedSubmissionId:result.queuedSubmission.id,threadId}
  if(result.turn)return {turnId:result.turn.id,threadId}
  if(result.thread)return {threadId:result.thread.id}
  return result
 }
 if(!requestId)return run()
 return managementWrite(context,owner,caller,name,args,async op=>{op.data=await run();op.status='confirmed'})
}
