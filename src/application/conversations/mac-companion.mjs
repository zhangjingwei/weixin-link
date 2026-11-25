import {taskProgress} from '../../domain/tasks/progress-state.mjs'
import {createHash} from 'node:crypto'
import {basename,join,resolve,sep} from 'node:path'
import {entryRequestId,taskId} from '../../domain/messages/message-identity.mjs'
import {historyInputText} from './history.mjs'

const states=new Set(['accepted','partial','failed','unknown','cancelled','deferred','pending','sending','not_required'])
const delivery=value=>states.has(value)?value:undefined
const results=record=>[...(record.resultArchive??[]).filter(item=>item.identity.id!==record.resultIdentity?.id),{identity:record.resultIdentity,updates:record.lastConversationUpdates,lastReply:record.lastReply,lastOutput:record.lastOutput}]

// Navigate only when both immutable task identities still resolve inside this owner's catalog.
function routedResults(ops,owner,key,entries,users){
 const targets=new Map()
 for(const op of ops??[]){
  if(op.owner!==owner||op.caller!==key||op.name!=='route_conversation_request'||op.status!=='queued'||!op.sourceTaskId||!op.data?.taskId)continue
  const target=entries.find(e=>e.id===op.data.projectId&&e.id===op.projectId&&e.key!==key),record=users[target?.key]
  if(!target||!record?.threadId)continue
  const result=results(record).find(r=>r.lastReply&&r.identity?.threadId===record.threadId&&r.identity.taskId===op.data.taskId)
  if(result?.identity.id)targets.set(op.sourceTaskId,{project:target.id,result:result.identity.id})
 }
 return targets
}

export function macCompanion({access,owner,conversations,manager,jobs,stateDir,submit,notice,ready}){
 const stale=()=>{throw Object.assign(Error('COMPANION_STALE'),{statusCode:409})}
 return async request=>{
  const catalog=conversations.ensure(owner),entries=catalog.entries.filter(item=>!item.archived&&!item.deleted)
  const viewing=request.action==='view',selected=viewing&&request.project!==undefined?request.project:catalog.active
  const entry=entries.find(item=>item.id===selected)
  if(!entry||entry.deleted||entry.archived)throw Error('COMPANION_NO_CONVERSATION')
  const key=entry.key,record=manager.state.users[key]??{},session=manager.sessions.get(key),state=access.read()
  const thread=record.threadId??'',turn=session?.state==='running'&&!session.finalReceived?session.turnId??'':''
  const identity={project:entry.id,thread,turn}
  if(request.action==='view'){
   const routes=routedResults(manager.state.managementOperations,owner,key,entries,manager.state.users)
   const messages=[],files=[],hash=createHash('sha256').update(key).digest('hex').slice(0,24)
   const addFiles=(parts,folder)=>{const start=files.length;for(const item of parts??[]){const root=join(stateDir,folder,hash)+sep;if(typeof item.path==='string'&&resolve(item.path).startsWith(root))files.push({name:basename(item.fileName??item.name??item.path),path:resolve(item.path),root:root.slice(0,-1),...(folder==='outgoing'&&delivery(item.status)?{delivery:item.status}:{}),...(folder==='outgoing'&&typeof item.sourcePath==='string'?{sourcePath:item.sourcePath}:{})})}return files.slice(start)}
   const queued=jobs.companionMessages(key,thread),byJob=new Map(queued.map(j=>[j.id,j])),seenJobs=new Set(),supplementReceipts=new Map()
   for(const receipt of jobs.companionIngress?.(key,thread)??[]){
    const route=catalog.entryRoutes?.[receipt.id],job=byJob.get(receipt.chat_job??taskId(key,receipt.id))
    const steps=route?.currentProjectId===entry.id?(route.steps??[]):[]
    const sameThread=step=>step.projectId===entry.id&&step.threadId===thread
    if(receipt.chat_thread!==thread){
     if(receipt.chat_thread||!(job&&job.thread_id===thread)&&!queued.some(j=>j.ingress_id===receipt.id&&j.thread_id===thread)&&!steps.some(sameThread))continue
    }
    const matching=[...new Set([job,...queued.filter(j=>j.ingress_id===receipt.id),...steps.flatMap((step,i)=>sameThread(step)?[byJob.get(route.receipts?.[i]?.taskId)]:[])].filter(Boolean))]
    for(const item of matching)seenJobs.add(item.id)
    // New supplements retain their exact request identity, even after routing records expire.
    const bubble={role:'你',text:receipt.text||'附件',time:receipt.created,messageId:receipt.id,files:addFiles(matching.flatMap(j=>JSON.parse(j.files)),'attachments')}
    messages.push(bubble)
    supplementReceipts.set(receipt.id,bubble)
    supplementReceipts.set(entryRequestId(receipt.id),bubble)
    for(const [i,step] of steps.entries())if(i&&sameThread(step)&&step.action==='supplement')supplementReceipts.set(entryRequestId(receipt.id+':'+i),bubble)
   }
   for(const job of queued){
    if(seenJobs.has(job.id))continue
    const text=historyInputText(job.text??'').split(/\n\n附件接入说明：|来源会话中已商定的方案（供落实本轮原始请求，沿用原授权范围）：/u,1)[0]
    messages.push({role:'你',text:text||'附件',time:job.created,messageId:job.id,files:addFiles(JSON.parse(job.files),'attachments')})
   }
   for(const item of record.supplements??[]){
    if(item.threadId!==thread)continue
    const original=supplementReceipts.get(item.chatReceipt)??supplementReceipts.get(item.requestId)
    if(original){original.role='补充 · '+item.status;continue}
    messages.push({role:'补充 · '+item.status,text:item.text,time:Date.parse(item.created),messageId:item.id})}
   for(const result of results(record)){
    if(!result.lastReply||result.identity?.threadId!==thread)continue
    const {execution,footerOffset}=result.identity
    const marker={completed:'✅ 本轮回答结束。',failed:'⚠️ 本轮执行失败，回答已结束。',interrupted:'⏹ 本轮已停止。'}[execution]
    const suffix='\n\n'+marker
    const exact=marker&&Number.isSafeInteger(footerOffset)&&footerOffset>=0&&result.lastReply.startsWith(suffix,footerOffset)
    const body=exact?result.lastReply.slice(0,footerOffset)+result.lastReply.slice(footerOffset+suffix.length):result.lastReply
    // Old records lack provenance. Let the client fold, but retain, a matching standalone status.
    const legacyFooter=footerOffset===undefined&&marker&&body.endsWith(suffix)?marker:undefined
    messages.push({role:'助手',resultId:result.identity.id,updates:result.updates,route:routes.get(result.identity.taskId),delivery:delivery(result.identity.delivery),text:body.slice(0,16000),legacyFooter:body.length<=16000?legacyFooter:undefined,truncated:body.length>16000,time:Date.parse(result.identity.createdAt),files:addFiles(result.lastOutput?.attachments,'outgoing')})
   }
   const progress=turn&&session.threadId===thread&&session.lastProgress?.turnId===turn?session.lastProgress.recent:undefined
   messages.sort((a,b)=>a.time-b.time)
   const window=messages.slice(-40),focus=typeof request.result==='string'&&messages.find(m=>m.resultId===request.result)
   if(focus&&!window.includes(focus))window.unshift(focus)
   return {...identity,...state,taskStatus:taskProgress(session),progress,diff:turn&&session.threadId===thread&&session.companionDiff?.turn===turn?session.companionDiff.text:undefined,name:entry.name,activeProject:catalog.active,conversations:entries.map(({id,key,name})=>{const saved=manager.state.users[key];return {id,name,group:saved?.nativeProjectId??null,groupLabel:saved?.nativeProjectId?(basename(saved.workspace??'')||saved.nativeProjectId):null}}),messages:window,files:files.slice(-40)}
  }
  if(!ready()||manager.state.desktopHandoff||manager.desktopTransition)throw Error('COMPANION_UNAVAILABLE')
  if(request.project!==entry.id||request.thread!==thread||state.revision!==request.revision)stale()
  if(request.action==='take'){
   const next=access.take('mac',state.revision)
   await notice(owner,`Mac 已接手，微信只读。回复「微信接手 ${next.revision}」可接回。`).catch(()=>{})
   return {status:'taken'}
  }
  if(state.writer!=='mac'||request.turn!==turn)stale()
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>12000||!/^[-\da-f]{36}$/i.test(request.id??''))throw Error('COMPANION_INVALID_TEXT')
  if(request.action==='steer'&&turn){
   const token=manager.lifecycle.capture(key)
   if(!jobs.claimReceipt('mac-steer:'+request.id))return {status:'unknown'}
   const result=await manager.steer(key,request.text,()=>{},{...token,current:()=>token.current()&&access.read().revision===state.revision},{traceId:session.traceId,turnId:turn})
   if(result?.status==='accepted')await notice(owner,'Mac 补充：'+request.text).catch(()=>{})
   return result
  }
  if(request.action!=='send'||turn||session?.busy||session?.finishing)stale()
  const id=submit(key,{text:request.text},'mac:'+request.id)
  if(jobs.claimReceipt('mac-notice:'+id))await notice(owner,'Mac 发来：'+request.text).catch(()=>{})
  return {status:'queued',id}
 }
}
