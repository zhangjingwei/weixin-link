import {isCatalogQuestion} from './catalog-question.mjs'
import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'
import {entryPlan} from '../../domain/tasks/entry-plan.mjs'
import {entryAction} from './entry-actions.mjs'
import {progressText} from '../management/progress-management.mjs'
import {taskId} from '../../domain/messages/message-identity.mjs'

// A free project session can answer ordinary text and use its bound management tools.
function localEntryDecision(message,record,projects,desktopHandoff,canAnswerDirectly){
 const text=message.text?.trim()??''
 if(record.pendingClarification||record.preparedInput||desktopHandoff)return null
 const projectId=record.currentProjectId
 if(/^入口(?:意图)?识别耗时多少[？?]?$/u.test(text))return {action:'routing_status',projectId}
 if(record.conversationFocus&&record.conversationFocus.projectId!==projectId)return null
 const namedProjects=projects.filter(p=>p.name&&text.toLowerCase().includes(p.name.toLowerCase()))
 // Multiple named destinations may need a durable plan with task dependencies.
 const current=projects.find(p=>p.projectId===projectId)
 if(canAnswerDirectly&&!current?.queued&&!current?.pendingApprovals&&record.recentTopics?.length<=1&&namedProjects.length<=1){
  return {action:'task',projectId}
 }
 if(namedProjects.length)return null
 const acknowledgement=/^(?:是的|明白了|谢谢你?|收到|好的|thanks|thank you)[。.!！]?$/iu
 const definition=/^(?:什么是|(?:请|帮我)?解释一下(?:什么是)?|what (?:is|are) )[\p{L}\p{N} +#-]{1,40}[？?。]?$/iu
 if(acknowledgement.test(text)||definition.test(text)&&!/项目|任务|进度|进展|记录|排队|上次|刚才|入口|接续|project|task|queue/iu.test(text)){
  return {action:'task',projectId}
 }
 return null
}

// Only user-initiated routes supply conversational context. Background deliveries
// never enter this ledger. Freeze its short summary when capturing a new decision.
function recentTopics(root,source,projects){
 const topics=[],seen=new Set(),since=Date.now()-1800000
 const routes=Object.values(root.entryRoutes).reverse().filter(route=>
  route.status==='done'&&route.currentProjectId===source.id&&route.createdAt>since&&
  route.selectionVersion===(root.selectionVersion??0)).sort((a,b)=>b.createdAt-a.createdAt)
 for(const route of routes){
  if(route.steps?.length>1)break
  const step=route.steps?.[0]
  if(!step||seen.has(step.projectId))continue
  if(!(step.action==='task'&&route.receipts?.[0]?.taskId)&&!route.queryAnswered)continue
  const project=projects.find(p=>p.projectId===step.projectId&&!p.archived)
  if(!project)continue
  topics.push({projectId:project.projectId,name:project.name,title:step.title})
  seen.add(project.projectId)
  if(topics.length===4)break
 }
 return topics
}

// The classifier has no execution authority. All effects use existing owner-bound
// management operations and the original durable queue, never a second scheduler.
export class EntryRouting{
 constructor({log=()=>{},manager,conversations,jobs,service,classify,deliver,prepareHandoff,canAnswerDirectly=false,modelManagedConversations=false,ready=()=>true,track=fn=>fn()}){Object.assign(this,{log,manager,conversations,jobs,service,classify,deliver,prepareHandoff,canAnswerDirectly,modelManagedConversations,ready,track});this.lanes=new Map()}
 process(message,token,preparedInput){
  // The execution model owns conversational decisions through MCP.
  if(this.modelManagedConversations)return Promise.resolve(false)
  if(!this.classify||!message._ingressId||message._promptReply||this.manager.state.users[message.userId]?.waitingAttachment)return Promise.resolve(false)
  if(this.jobs.get(taskId(message.userId,message._ingressId)))return Promise.resolve(false)
  const owner=message._conversationOwner??message.userId,previous=this.lanes.get(owner)
  if((previous?.count??0)>=20)return Promise.resolve(false)
  if(previous)this.log('routing.queued',{trace_id:message._traceId})
  const lane=previous??{tail:Promise.resolve(),count:0};lane.count++;this.lanes.set(owner,lane)
  const run=lane.tail.catch(()=>{}).then(()=>this.track(()=>this.route(message,token,preparedInput)))
  lane.tail=run
  return run.finally(()=>{lane.count--;if(!lane.count&&this.lanes.get(owner)===lane)this.lanes.delete(owner)})
 }
 async route(message,token,preparedInput){
  const current=()=>!this.closed&&this.ready()&&token.current()&&this.jobs.rawCurrent(message._ingressId)
  if(!current())return true
  const owner=message._conversationOwner??message.userId,id=message._ingressId
  const root=this.conversations.ensure(owner);root.entryRoutes??={}
  for(const [key,value]of Object.entries(root.entryRoutes))if(value.createdAt<Date.now()-7*86400000&&['done','fallback'].includes(value.status))delete root.entryRoutes[key]
  let record=root.entryRoutes[id]
  if(!record&&!preparedInput&&!this.manager.state.desktopHandoff&&isCatalogQuestion(message.text))return false
  if(record?.status==='fallback')return false
  if(record?.status==='done'){this.jobs.acknowledge([id]);return true}
  if(['sending','delivery_unknown'].includes(record?.status)){this.jobs.acknowledge([id]);return true} // delivery may have happened; never resend blindly
  const projects=this.service.entries(owner).map(e=>this.service.snapshot(owner,e)),source=this.conversations.entry(message.userId)
  if(!source)return false
  if(!record&&Object.keys(root.entryRoutes).length>=1000)return false
  const queuedSnapshot=()=>Object.fromEntries(projects.map(p=>[p.projectId,(this.jobs.pending?.()??[]).filter(j=>j.owner===this.service.target(owner,p.projectId).key&&j.state==='pending').map(j=>({taskId:j.id,title:taskDisplayTitle(j.input,j.input?.projectDispatch?.title)}))]))
  if(!record){const topics=recentTopics(root,source,projects);record=root.entryRoutes[id]={createdAt:Date.now(),status:'deciding',currentProjectId:source.id,conversationFocus:topics[0],recentTopics:topics,selectionVersion:root.selectionVersion??0,queuedSnapshot:queuedSnapshot(),materialSourceKey:message.userId,materialIngressId:id,preparedInput:preparedInput?structuredClone(preparedInput):message.references?.length?{references:structuredClone(message.references)}:undefined,pendingClarification:root.entryClarification?.createdAt>Date.now()-600000&&(!root.entryClarification.materialSourceKey||root.entryClarification.materialSourceKey===message.userId)?structuredClone(root.entryClarification):null};await this.manager.save()}
  if(!record.decision){
   record.queuedSnapshot??=queuedSnapshot()
   const candidateInput=record.preparedInput??record.pendingClarification?.preparedInput
   const session=this.manager.sessions.get(message.userId)
   let decision=localEntryDecision(message,record,projects,this.manager.state.desktopHandoff,this.canAnswerDirectly&&!session?.busy&&!session?.finishing)
   if(decision)this.log('routing.local',{trace_id:message._traceId})
   if(!decision){
    const started=Date.now();root.entryRoutingMetrics??={classified:0,fallbacks:0};record.status='classifying';await this.manager.save()
    const trace_id=message._traceId
    this.log('routing.classifying',{trace_id})
    const classificationStart=Date.now()
    try{decision=await this.classify({text:message.text,references:(message.references??[]).slice(0,3).map(r=>({title:r.title,text:r.text?.slice(0,500)})),currentAttachments:(candidateInput?.attachments??[]).map(a=>({name:a.name,kind:a.kind})),currentProjectId:record.currentProjectId,conversationFocus:record.conversationFocus,recentTopics:record.recentTopics,pendingClarification:record.pendingClarification,desktopHandoff:this.manager.state.desktopHandoff?{projectId:this.manager.state.desktopHandoff.projectId,phase:this.manager.state.desktopHandoff.phase}:null,projects:projects.map(p=>({projectId:p.projectId,name:p.name,archived:p.archived,state:p.state,task:p.task,queued:p.queued,queuedTasks:(record.queuedSnapshot[p.projectId]??[]).slice(0,5)}))});this.log('routing.classified',{trace_id,duration_ms:Date.now()-classificationStart})}
    catch(error){
     this.log('routing.failed',{trace_id,reason:'error',duration_ms:Date.now()-classificationStart})
     record.fallbackCode=/^ENTRY_ROUTER_[A-Z_]+$/.test(error.message)?error.message:'ENTRY_ROUTER_CLASSIFICATION_FAILED';root.entryRoutingMetrics.lastFallbackCode=record.fallbackCode;root.entryRoutingMetrics.fallbacks++;root.entryRoutingMetrics.lastLatencyMs=Date.now()-started;if(!current())return true
     if(record.recentTopics?.length>1||record.conversationFocus&&record.conversationFocus.projectId!==record.currentProjectId){
      decision={action:'clarify',question:'这条消息要接着哪个项目聊？请告诉我项目名称。'}
     }else{record.status='fallback';await this.manager.save();return false}
    }
    if(!record.fallbackCode)root.entryRoutingMetrics.classified++
    root.entryRoutingMetrics.lastLatencyMs=Date.now()-started
   }
   if(!current())return true
   const continuation=decision.useClarification===true&&record.pendingClarification
   record.text=continuation?continuation.text+'\n用户对目标的补充澄清：'+message.text:message.text
   if(continuation&&!record.preparedInput){record.preparedInput=structuredClone(continuation.preparedInput);record.materialSourceKey=continuation.materialSourceKey??message.userId;record.materialIngressId=continuation.materialIngressId??id}
   let steps
   try{steps=entryPlan(decision,record.text,projects)}catch(error){if(error.message==='ENTRY_TARGET_UNCONFIRMED')steps=[{action:'clarify',question:'未定位到唯一匹配项目，请明确项目名称。',dependsOn:[]}];else{record.status='fallback';await this.manager.save();return false}}
   if(record.recentTopics?.length>1&&steps.some(step=>{
    if(!['stop','cancel','cancel_all','prioritize'].includes(step.action))return false
    const target=projects.find(p=>p.projectId===step.projectId)
    return !target?.name||!message.text?.includes(target.name)||projects.filter(p=>p.name===target.name).length!==1
   }))steps=[{action:'clarify',question:'你想操作哪个项目的任务？请告诉我项目名称。',dependsOn:[]}]
   record.steps=steps.map(step=>{const target=projects.find(p=>p.projectId===step.projectId);const entry=target&&this.service.target(owner,target.projectId);return {...step,title:taskDisplayTitle(record.text,step.title),threadId:target?.threadId??null,task:target?.task??null,queuedTasks:entry?record.queuedSnapshot[step.projectId]??[]:[]}})
   record.decision=record.steps[0]
   if(record.decision.action==='clarify')root.entryClarification={text:record.text,question:record.decision.question,createdAt:Date.now(),preparedInput:record.preparedInput,materialSourceKey:record.materialSourceKey,materialIngressId:record.materialIngressId}
   else delete root.entryClarification
   record.task=record.decision.task;record.threadId=record.decision.threadId;record.status='decided';await this.manager.save()
  }
  if(!current())return true
  const caller=message.userId
  record.steps??=[{...record.decision,task:record.task,threadId:record.threadId,dependsOn:[]}]
  const outputs=[]
  let queryAnswered=false
  for(let index=0;index<record.steps.length;index++){
   if(!current())return true
   try{outputs.push(await entryAction(this,message,record,record.steps[index],index));queryAnswered=record.steps.length===1&&['status','result','history'].includes(record.steps[index].action);await this.manager.save()}
   catch(error){outputs.push(error.message==='MANAGEMENT_DESKTOP_EXECUTION_PAUSED'?'桌面正在接续这个账号的工作，微信暂不执行新任务。请先关闭桌面，再说“回到微信继续”。':'这条请求未确认执行；目标或任务可能已变化，未转交其他项目或新建替代任务。请明确项目及要执行的操作。');break}
  }
  const output=outputs.filter(Boolean).join('\n\n').replace(/!?\[([^\]]*)\]\([^\n]*?\)/g,'$1')
  if(!output){record.status='done';await this.manager.save();this.jobs.acknowledge([id]);return true}
  record.status='sending';await this.manager.save()
  if(!current())return true
  const delivery=await this.deliver(caller,output,{conversationControl:true,traceId:message._traceId,current})
  if(queryAnswered&&delivery?.status==='accepted')record.queryAnswered=true
  record.status=delivery?.status==='accepted'?'done':'delivery_unknown';await this.manager.save();this.jobs.acknowledge([id]);if(delivery?.status==='accepted')for(const operationId of record.activations??[])await this.service.activate(caller,operationId);return true
 }
 async progress(caller,args){return progressText(await this.service.call(caller,'get_project_progress',args))}
 async close(){this.closed=true;await this.classify?.close?.();await Promise.allSettled([...this.lanes.values()].map(lane=>lane.tail))}
}
