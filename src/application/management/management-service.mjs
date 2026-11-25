import {conversationContext,repositoryContext,associateRepositoryConversations} from './conversation-management.mjs'
import {desktopStatus,requestDesktop,executeDesktop} from './desktop-management.mjs'
import {projectProgress} from './progress-management.mjs'
import {changeQueuedTask,cancelQueuedTasks} from './queue-management.mjs'
import {requestModelSwitch} from './model-management.mjs'
import {requestProjectArchive,executeProjectArchive} from './project-archive-management.mjs'
import {maintenanceRead,requestMaintenance,executeMaintenance} from './maintenance-management.mjs'
import {submitProjectTask,routeConversationRequest} from './project-task-management.mjs'
import {pruneManagementOperations,discardUnexecutedPayload} from './management-writes.mjs'
import {workspaceChoices,createProject,renameProject,openProjectSession,openConversation} from './project-management.mjs'
import {listProjectTasks,getTaskResult,requestResultRedelivery,executeRedelivery,requestTaskReconciliation,executeReconciliation} from './result-management.mjs'
import {hasNativeControl,nativeControl} from './native-controls.mjs'
import {searchNativeHistory} from './history-search.mjs'
import {createSchedule,listSchedules,cancelSchedule} from './schedule-management.mjs'
import {checkUpdates,skipUpdate} from './update-management.mjs'
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto'
import {historyInputText,historyText} from '../conversations/history.mjs'
import {validateManagementCall} from './tools.mjs'

const signatureFor=(name,args)=>createHmac('sha256','zerolink-operation-v1').update(JSON.stringify([name,Object.keys(args).sort().map(key=>[key,args[key]])])).digest('hex')

// A management facade over the existing conversation/task state, not another queue.
export class ManagementService{
 constructor({manager,conversations,notice=async()=>{},now=Date.now,ready=()=>true,track=work=>work(),deliver=async()=>{throw Error('MANAGEMENT_DELIVERY_UNAVAILABLE')},schedules,updates,enqueueTask,prepareHandoff,inspectRepository,maintenance,desktop,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}){
  Object.assign(this,{manager,conversations,notice,now,ready,track,deliver,schedules,updates,enqueueTask,prepareHandoff,inspectRepository,maintenance,desktop,timeZone});this.cursorKey=randomUUID();this.timers=new Map();this.expirations=new Map();this.inflight=new Map()
  manager.state.managementOperations??=[];this.operations=manager.state.managementOperations
  for(const op of this.operations)if(['pending','executing'].includes(op.status))op.status=op.status==='pending'?'not_executed':'unknown'
  pruneManagementOperations(this.operations,this.now())
 }
 owner(caller){const entry=this.conversations.entry(caller);if(!entry||!this.conversations.realOwners.has(entry.owner))throw Error('MANAGEMENT_FORBIDDEN');return entry.owner}
 entries(owner){return (this.conversations.root[owner]?.entries??[]).filter(e=>!e.deleted&&!e.deleteIntent)}
 target(owner,id){const e=this.entries(owner).find(e=>e.id===id);if(!e)throw Error('MANAGEMENT_TARGET_NOT_FOUND');return e}
 snapshot(owner,e){
  const saved=this.manager.state.users[e.key]??{},s=this.manager.sessions.get(e.key)
  return {projectId:e.id,nativeProjectId:saved.nativeProjectId??null,name:e.name,active:this.conversations.root[owner].active===e.id,archived:!!e.archived,workspace:saved.workspace??null,workspaceSource:'local_configuration',threadId:saved.threadId??null,configuredModel:saved.modelOverride??null,connectedModel:s?.model??null,turnModel:s?.executionModel??null,turnTokenUsage:s?.tokenUsage??null,nativeStatus:s?.nativeStatus??null,nativeActiveFlags:s?.nativeActiveFlags??[],goal:s?.nativeGoal??null,state:s?.state??'disconnected',task:s?.busy&&s.traceId&&s.turnId?{id:s.traceId,turnId:s.turnId,jobId:s.taskId??null}:null,queued:(s?.queue?.length??0)+(this.manager.submissions?.pending?.()??[]).filter(j=>j.owner===e.key).length,uncertain:this.manager.submissions?.uncertainCount?.(e.key)??0,recovery:saved.recovery??null,lastProgress:s?.lastProgress?.turnId===s?.turnId?s?.lastProgress?.text?.slice(0,2000)??null:null,progressTruncated:(s?.lastProgress?.text?.length??0)>2000,pendingApprovals:[...this.manager.questions.values()].filter(q=>q.session.userId===e.key).length,latestResult:saved.resultIdentity??null,executionOwner:this.manager.state.desktopHandoff?'desktop':'wechat',evidence:'local_runtime',observedAt:new Date(this.now()).toISOString()}
 }
 exact(e,args){const s=this.manager.sessions.get(e.key);if(!s||!s.busy||s.traceId!==args.taskId||s.turnId!==args.turnId||s.rpc?.closed)throw Error('MANAGEMENT_STALE_TASK');return s}
 async call(caller,name,args){
  const spec=validateManagementCall(name,args);const owner=this.owner(caller)
  if(this.manager.state.desktopHandoff&&!spec.annotations.readOnlyHint&&!['request_desktop_handoff','request_desktop_return'].includes(name))throw Error('MANAGEMENT_DESKTOP_EXECUTION_PAUSED')
  if(name==='get_conversation_context')return conversationContext(this,owner,caller)
  if(name==='get_conversation_repository')return repositoryContext(this,owner,args)
  if(name==='associate_repository_conversations')return associateRepositoryConversations(this,owner,caller,args)
  if(hasNativeControl(name))return nativeControl(this,owner,caller,name,args)
  if(name==='get_desktop_status')return desktopStatus(this,owner)
  if(['request_desktop_handoff','request_desktop_return'].includes(name)){
   const previous=this.manager.state.desktopHandoff
   if(name==='request_desktop_return'&&previous?.phase==='waiting'&&previous.projectId===args.projectId){
    const pending=this.operations.find(op=>op.id===previous.operationId&&op.owner===owner&&op.status==='pending')
    if(pending){pending.status='not_executed';pending.detail='MANAGEMENT_DESKTOP_RETURN_REQUESTED';clearTimeout(this.expirations.get(pending.id));this.expirations.delete(pending.id);await this.manager.save()}
   }
   this.manager.desktopTransition=true
   try{return await requestDesktop(this,owner,caller,name,args)}
   catch(error){if(previous)this.manager.state.desktopHandoff=previous;throw error}
   finally{this.manager.desktopTransition=false;if(!this.manager.state.desktopHandoff)this.resumeTasks?.()}
  }
  if(name==='request_queue_cancel_all')return cancelQueuedTasks(this,owner,caller,args)
  if(name==='request_queue_change')return changeQueuedTask(this,owner,caller,args)
  if(name==='request_model_switch')return requestModelSwitch(this,owner,caller,args)
  if(name==='request_project_archive')return requestProjectArchive(this,owner,caller,args)
  if(['get_service_status','get_installation_status','get_diagnostics','get_usage_guide','get_maintenance_status'].includes(name))return maintenanceRead(this,owner,name,args)
  if(['request_service_restart','request_upgrade'].includes(name))return requestMaintenance(this,owner,caller,name,args)
  const extended={open_conversation:()=>openConversation(this,owner,caller,args),route_conversation_request:()=>routeConversationRequest(this,owner,caller,args),create_project_session:()=>openProjectSession(this,owner,caller,args),submit_project_task:()=>submitProjectTask(this,owner,caller,args),list_workspace_choices:()=>workspaceChoices(this,owner,args),create_project:()=>createProject(this,owner,caller,args),rename_project:()=>renameProject(this,owner,caller,args),search_sessions:()=>searchNativeHistory(this,owner,args,true),search_session_history:()=>searchNativeHistory(this,owner,args),list_project_tasks:()=>listProjectTasks(this,owner,args),get_task_result:()=>getTaskResult(this,owner,args),request_result_redelivery:()=>requestResultRedelivery(this,owner,caller,args),request_task_reconciliation:()=>requestTaskReconciliation(this,owner,caller,args),check_updates:()=>checkUpdates(this,owner),skip_update:()=>skipUpdate(this,owner,caller,args),create_schedule:()=>createSchedule(this,owner,caller,args),list_schedules:()=>listSchedules(this,owner,args),cancel_schedule:()=>cancelSchedule(this,owner,caller,args)}
  if(extended[name])return extended[name]()
  if(name==='get_management_operation'){const op=this.operations.find(op=>op.id===args.operationId&&op.owner===owner);if(!op)throw Error('MANAGEMENT_OPERATION_NOT_FOUND');return this.result(op)}
  if(name==='list_projects'){
   const nativeProjects=await this.conversations.codexProjects?.(owner)??null
   return {nativeProjects,codexProjects:nativeProjects?.map(project=>project.name)??null,callerProjectId:this.conversations.entry(caller).id,projects:this.entries(owner).map(e=>this.snapshot(owner,e))}
  }
  if(name==='resolve_target'){
   const q=args.query.normalize('NFKC').trim().toLowerCase(),entries=this.entries(owner)
   const exact=entries.filter(e=>[e.id,e.name].some(v=>String(v).normalize('NFKC').toLowerCase()===q))
   const found=exact.length?exact:entries.filter(e=>[e.name,this.manager.state.users[e.key]?.workspace].some(v=>v&&String(v).normalize('NFKC').toLowerCase().includes(q)))
   return {resolution:found.length===1?'unique':found.length?'ambiguous':'not_found',candidates:found.map(e=>this.snapshot(owner,e)),changed:false}
  }
  if(name==='list_project_sessions'){
   const api=this.conversations.backendPort?.nativeProjects
   if(!api)throw Error('MANAGEMENT_NATIVE_PROJECTS_UNAVAILABLE')
   const page=await this.conversations.withBackend(owner,rpc=>api.sessions(rpc,args.nativeProjectId,args.cursor))
   if(!args.cursor&&!page.nextCursor){
    for(const entry of this.entries(owner)){
     const session=this.manager.sessions.get(entry.key),saved=this.manager.state.users[entry.key],threadId=session?.threadId??(saved?.workspaceMigratedFrom?saved.threadId:null)
     if(!entry.archived&&threadId&&(!args.nativeProjectId||saved?.nativeProjectId===args.nativeProjectId)&&!page.sessions.some(t=>t.threadId===threadId)){
      page.sessions.push({threadId,name:entry.name,cwd:this.manager.workspaceFor(entry.key)})
     }
    }
   }
   return page
  }
  if(name==='list_models')return this.conversations.withBackend(owner,rpc=>this.manager.protocol.listModels(rpc))
  const e=this.target(owner,args.projectId)
  if(name==='get_project_progress')return projectProgress(this,owner,args)
  if(name==='get_project_status')return {...this.snapshot(owner,e),operationsTotal:this.operations.filter(o=>o.owner===owner&&o.projectId===e.id).length,operations:this.operations.filter(o=>o.owner===owner&&o.projectId===e.id).slice(-20).map(op=>({...this.result(op),name:op.name,requestId:op.requestId,createdAt:op.createdAt}))}
  if(name==='get_session_history')return this.history(owner,e,args.cursor)
  // Serialize duplicate writes until their uncertain intent has reached durable storage.
  const key=JSON.stringify([owner,args.requestId]),running=this.inflight.get(key)
  const signature=signatureFor(name,args)
  if(running){if(running.signature!==signature)throw Error('MANAGEMENT_REQUEST_CONFLICT');return running.work}
  const work=this.mutate(owner,caller,e,name,args);this.inflight.set(key,{signature,work})
  try{return await work}finally{this.inflight.delete(key)}
 }
 async mutate(owner,caller,e,name,args){
  const signature=signatureFor(name,args)
  const previous=this.operations.find(o=>o.owner===owner&&o.requestId===args.requestId)
  if(previous){if(previous.signature!==signature)throw Error('MANAGEMENT_REQUEST_CONFLICT');return this.result(previous)}
  if(e.archived||e.archiveIntent!==undefined||e.archiveSync==='missing')throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
  if(this.operations.some(o=>o.owner===owner&&['pending','executing'].includes(o.status)))throw Error('MANAGEMENT_OPERATION_PENDING')
  pruneManagementOperations(this.operations,this.now())
  if(this.operations.filter(o=>o.owner===owner).length>=10000)throw Error('MANAGEMENT_OPERATION_LIMIT')
  if(name!=='request_project_switch')this.exact(e,args)
  const root=this.conversations.root[owner]
  const op={id:randomUUID(),owner,caller,projectId:e.id,name,requestId:args.requestId,signature,status:name==='supplement_task'?'executing':'pending',createdAt:this.now(),threadId:this.manager.state.users[e.key]?.threadId??null,taskId:args.taskId,turnId:args.turnId,callerTask:this.manager.sessions.get(caller)?.traceId,selectionVersion:root.selectionVersion??0}
  this.operations.push(op)
  try{await this.manager.save()}catch(error){op.status='not_executed';throw error}
  if(op.status==='pending')this.expire(op)
  if(name==='supplement_task'){
   const notices=[]
   try{this.exact(e,args);const result=await this.manager.steer(e.key,args.text,t=>notices.push(t),this.manager.lifecycle.capture(e.key),{traceId:args.taskId,turnId:args.turnId,requestId:args.requestId});op.status=result?.status??'unknown';op.detail=notices.join('\n')}catch(error){op.status=error.message==='MANAGEMENT_STALE_TASK'?'not_sent':'unknown'}
   await this.manager.save()
  }
  return this.result(op)
 }
 result(op){return {operationId:op.id,status:op.status,projectId:op.projectId,detail:op.detail??null,...op.data?{data:op.data}:{}}}
 expire(op){const timer=setTimeout(()=>{this.expirations.delete(op.id);if(op.status==='pending'){op.status='not_executed';op.detail='MANAGEMENT_RECEIPT_EXPIRED';discardUnexecutedPayload(op);void this.manager.save().catch(()=>{})}},300000);timer.unref?.();this.expirations.set(op.id,timer)}
 credential(token,kind,owner){const value=this.decode(token);if(value.kind!==kind||value.owner!==owner||!Number.isFinite(value.expires)||value.expires<=this.now())throw Error('MANAGEMENT_CREDENTIAL_INVALID');return value}
 // Armed only after the MCP transport has written its tool response. A lost receipt
 // stays pending and is never blindly replayed after a service restart.
 async activate(caller,id){
  const owner=this.owner(caller),op=this.operations.find(o=>o.id===id&&o.owner===owner&&o.caller===caller)
  if(!op||op.status!=='pending'||this.timers.has(id))return
  const poll=()=>{this.timers.delete(id);void this.execute(op).catch(()=>{})}
  const timer=setTimeout(poll,50);timer.unref?.();this.timers.set(id,timer)
 }
 async execute(op){return this.track(()=>this.run(op))}
 async run(op){
  if(op.status!=='pending')return
  if(['request_result_redelivery','request_task_reconciliation','request_service_restart','request_upgrade','request_project_archive','request_desktop_handoff'].includes(op.name))return this.runExtended(op)
  const {manager,conversations}=this,root=conversations.root[op.owner]
  try{
   if(this.closed||!this.ready())throw Error('MANAGEMENT_UNAVAILABLE')
   const e=this.target(op.owner,op.projectId)
   if((manager.state.users[e.key]?.threadId??null)!==op.threadId)throw Error('MANAGEMENT_STALE_TARGET')
   if(op.name==='request_project_switch'){
    const caller=manager.sessions.get(op.caller)
    if((root.selectionVersion??0)!==op.selectionVersion||caller?.traceId!==op.callerTask)throw Error('MANAGEMENT_SUPERSEDED')
    if(this.now()-op.createdAt>300000)throw Error('MANAGEMENT_SWITCH_EXPIRED')
    if(caller?.busy||caller?.finishing||caller?.connecting){await this.activate(op.caller,op.id);return}
   }else this.exact(e,op)
   op.status='executing';await manager.save()
   if(this.closed)throw Error('MANAGEMENT_UNAVAILABLE')
   if(op.name==='request_project_switch'){
    if((root.selectionVersion??0)!==op.selectionVersion||manager.sessions.get(op.caller)?.traceId!==op.callerTask)throw Error('MANAGEMENT_SUPERSEDED')
    const version=root.selectionVersion=(root.selectionVersion??0)+1
    let confirmation
    await conversations.selectConversation({_conversationOwner:op.owner,userId:e.key,_conversationCommand:{action:'switch',id:e.id},_conversationSelectionVersion:version,_conversationPriorActive:root.active},text=>{confirmation=text})
    op.status=root.active===e.id&&root.selectionVersion===version?'confirmed':'superseded';op.detail=confirmation
   }else{
    const result=await manager.handle(e.key,'',()=>{},undefined,manager.lifecycle.capture(e.key),{action:'stop',expected:{traceId:op.taskId,turnId:op.turnId},preserveReply:true})
    op.status=result?.status??'unknown'
   }
  }catch(error){op.status=op.status==='executing'?'unknown':'not_executed';op.detail=/^MANAGEMENT_[A-Z_]+$/.test(error.message)?error.message:'MANAGEMENT_OPERATION_UNCONFIRMED'}
  clearTimeout(this.expirations.get(op.id));this.expirations.delete(op.id)
  await manager.save()
  const label=op.name==='request_project_switch'?'切换':'停止'
  const notice=op.status==='confirmed'?op.detail:op.status==='requested'?'已请求停止原任务，并清空其排队消息。停止结果以原会话最终状态为准。':op.detail==='MANAGEMENT_SUPERSEDED'?'切换请求已被后续操作替代，未执行。':op.status==='not_executed'?`${label}请求未执行；原目标已变化或当前无法操作。`:`${label}结果尚未确认，未自动重试；可查询项目状态核对。`
  await this.notice(op.owner,notice).catch(()=>{})
 }
 async runExtended(op){
  try{
   if(this.closed||!this.ready())throw Error('MANAGEMENT_UNAVAILABLE')
   const done=op.name==='request_desktop_handoff'?await executeDesktop(this,op):op.name==='request_project_archive'?await executeProjectArchive(this,op):['request_service_restart','request_upgrade'].includes(op.name)?await executeMaintenance(this,op):op.name==='request_result_redelivery'?await executeRedelivery(this,op):await executeReconciliation(this,op)
   if(done===false)return
  }catch(error){op.status=op.status==='executing'?'unknown':'not_executed';op.detail=/^(?:MANAGEMENT|SCHEDULE|UPDATE)_[A-Z_]+$/.test(error.message)?error.message:'MANAGEMENT_OPERATION_UNCONFIRMED'}
  clearTimeout(this.expirations.get(op.id));this.expirations.delete(op.id)
  discardUnexecutedPayload(op)
  await this.manager.save()
  const notice=op.name==='request_desktop_handoff'?(op.status==='confirmed'?'已请求在桌面打开这个会话。请在电脑确认是否显示；桌面接续期间，微信暂不执行新任务。关闭桌面后可说“回到微信继续”。':!this.manager.state.desktopHandoff?'桌面接续已取消，微信可以继续处理工作。':'桌面打开结果尚未确认，微信任务仍暂停。请先关闭桌面，再说“回到微信继续”核对。'):op.name==='request_project_archive'&&op.status==='confirmed'?'项目归档状态已核对。': ['scheduled','already_scheduled'].includes(op.status)?'已安排，等当前工作结束后处理，完成后会通知你。':op.status==='up_to_date'?'当前版本无需升级，未安排维护。':op.status==='blocked'?'已有维护请求，未重复安排。':op.status==='requested'?'已安排核对指定原任务，未重新执行。':op.status==='accepted'?'已提交发送，尚未确认你是否收到。':op.status==='deferred'?'已安排发送，尚未确认送达。':op.status==='not_executed'?'请求未执行：'+op.detail:'请求结果尚未确认，未自动重试。'
  await this.notice(op.owner,notice).catch(()=>{})
 }
 sign(value){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return data+'.'+createHmac('sha256',this.cursorKey).update(data).digest('base64url')}
 decode(cursor){try{const [data,sig,...rest]=cursor.split('.'),expected=createHmac('sha256',this.cursorKey).update(data).digest(),actual=Buffer.from(sig,'base64url');if(rest.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();return JSON.parse(Buffer.from(data,'base64url'))}catch{throw Error('MANAGEMENT_INVALID_CURSOR')}}
 async history(owner,e,cursor){
  if(!this.conversations.backendPort?.capabilities.history)throw Error('MANAGEMENT_UNSUPPORTED')
  const threadId=this.manager.state.users[e.key]?.threadId
  if(!threadId)return {messages:[],nextCursor:null}
  const position=cursor?this.decode(cursor):{owner,projectId:e.id,threadId,index:0,offset:0}
  if(position.owner!==owner||position.projectId!==e.id||position.threadId!==threadId)throw Error('MANAGEMENT_INVALID_CURSOR')
  const page=await this.conversations.withBackend(owner,rpc=>this.conversations.backendPort.listTurns(rpc,threadId,{limit:1,cursor:position.backendCursor}))
  const items=(page.data??[]).flatMap(turn=>(turn.items??[]).flatMap(item=>{
   const text=item.type==='userMessage'?(item.content??[]).filter(c=>c.type==='text').map(c=>historyInputText(c.text??'')).join('\n'):item.type==='agentMessage'?item.text:null
   return text?[{role:item.type==='userMessage'?'user':'assistant',turnId:turn.id,startedAt:turn.startedAt??null,text:historyText(text)}]:[]
  }))
  const digest=createHmac('sha256',this.cursorKey).update(JSON.stringify(items)).digest('hex')
  if(position.digest&&position.digest!==digest)throw Error('MANAGEMENT_HISTORY_CHANGED')
  if(position.turnId&&items[0]?.turnId!==position.turnId)throw Error('MANAGEMENT_HISTORY_CHANGED')
  let index=position.index,offset=position.offset,budget=10000;const messages=[]
  while(index<items.length&&budget){const item=items[index],characters=Array.from(item.text.slice(offset)),text=characters.slice(0,budget).join('');messages.push({...item,text,offset,continued:offset>0,hasMore:offset+text.length<item.text.length});offset+=text.length;budget-=Math.min(characters.length,budget);if(offset>=item.text.length){index++;offset=0}}
  const next=index<items.length?{...position,turnId:items[0]?.turnId,digest,index,offset}:page.nextCursor?{owner,projectId:e.id,threadId,backendCursor:page.nextCursor,index:0,offset:0}:null
  return {messages,turns:(page.data??[]).map(turn=>({id:turn.id,startedAt:turn.startedAt??null,status:turn.status??null})),nextCursor:next?this.sign(next):null,order:'oldest_first_within_turn; next_cursor_is_older_turn_or_remaining_text',attachmentsResent:false}
 }
 close(){this.closed=true;for(const timer of [...this.timers.values(),...this.expirations.values()])clearTimeout(timer);this.timers.clear();this.expirations.clear()}
}
