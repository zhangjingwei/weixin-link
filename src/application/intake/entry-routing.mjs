import {createHash} from 'node:crypto'
import {submitProjectTask} from '../management/project-task-management.mjs'
import {taskId} from '../../domain/messages/message-identity.mjs'

const actions=new Set(['task','supplement','status','history','result','clarify'])
const requestId=id=>{const h=createHash('sha256').update('entry-route:'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}

// The classifier has no execution authority. All effects use existing owner-bound
// management operations and the original durable queue, never a second scheduler.
export class EntryRouting{
 constructor({manager,conversations,jobs,service,classify,deliver,ready=()=>true,track=fn=>fn()}){Object.assign(this,{manager,conversations,jobs,service,classify,deliver,ready,track});this.lanes=new Map()}
 process(message,token){
  if(!this.classify||!message._ingressId||message.references?.length||message._promptReply||this.manager.state.users[message.userId]?.waitingAttachment)return Promise.resolve(false)
  if(this.jobs.get(taskId(message.userId,message._ingressId)))return Promise.resolve(false)
  const owner=message._conversationOwner??message.userId,previous=this.lanes.get(owner)
  if((previous?.count??0)>=20)return Promise.resolve(false)
  const lane=previous??{tail:Promise.resolve(),count:0};lane.count++;this.lanes.set(owner,lane)
  const run=lane.tail.catch(()=>{}).then(()=>this.track(()=>this.route(message,token)))
  lane.tail=run
  return run.finally(()=>{lane.count--;if(!lane.count&&this.lanes.get(owner)===lane)this.lanes.delete(owner)})
 }
 async route(message,token){
  const current=()=>!this.closed&&this.ready()&&token.current()&&this.jobs.rawCurrent(message._ingressId)
  if(!current())return true
  const owner=message._conversationOwner??message.userId,id=message._ingressId
  const root=this.conversations.ensure(owner);root.entryRoutes??={}
  for(const [key,value]of Object.entries(root.entryRoutes))if(value.createdAt<Date.now()-7*86400000&&['done','fallback'].includes(value.status))delete root.entryRoutes[key]
  let record=root.entryRoutes[id]
  if(record?.status==='fallback')return false
  if(record?.status==='done'){this.jobs.acknowledge([id]);return true}
  if(['sending','delivery_unknown'].includes(record?.status)){this.jobs.acknowledge([id]);return true} // delivery may have happened; never resend blindly
  const projects=this.service.entries(owner).map(e=>this.service.snapshot(owner,e)),source=this.conversations.entry(message.userId)
  if(!source)return false
  if(!record&&Object.keys(root.entryRoutes).length>=1000)return false
  if(!record){record=root.entryRoutes[id]={createdAt:Date.now(),status:'deciding',currentProjectId:source.id,pendingClarification:root.entryClarification?.createdAt>Date.now()-600000?structuredClone(root.entryClarification):null};await this.manager.save()}
  if(!record.decision){
   let decision
   try{decision=await this.classify({text:message.text,currentProjectId:record.currentProjectId,pendingClarification:record.pendingClarification,projects:projects.map(p=>({projectId:p.projectId,name:p.name,archived:p.archived,state:p.state,task:p.task,queued:p.queued}))})}
   catch{if(!current())return true;record.status='fallback';await this.manager.save();return false}
   if(!current())return true
   if(!decision||!actions.has(decision.action)||Object.keys(decision).some(k=>!['action','projectId','question','useClarification'].includes(k))||decision.action!=='clarify'&&!projects.some(p=>p.projectId===decision.projectId)){
    record.status='fallback';await this.manager.save();return false
   }
   const target=projects.find(p=>p.projectId===decision.projectId)
   record.decision={action:decision.action,projectId:decision.projectId,question:typeof decision.question==='string'?decision.question.slice(0,500):null}
   record.text=decision.useClarification&&record.pendingClarification?record.pendingClarification.text+'\n用户对目标的补充澄清：'+message.text:message.text
   if(decision.action==='clarify')root.entryClarification={text:record.text,question:record.decision.question,createdAt:Date.now()}
   else delete root.entryClarification
   record.task=target?.task??null;record.threadId=target?.threadId??null;record.status='decided';await this.manager.save()
  }
  if(!current())return true
  const decision=record.decision,args={projectId:decision.projectId},caller=message.userId
  let output
  try{
   if(decision.action==='clarify')output=decision.question||'这条请求要交给哪个项目？'
   else{
    const target=this.service.target(owner,decision.projectId)
    if((this.manager.state.users[target.key]?.threadId??null)!==record.threadId)throw Error('ENTRY_TARGET_CHANGED')
    if(decision.action==='task'){
     const result=await submitProjectTask(this.service,owner,caller,{...args,text:record.text,requestId:requestId(id)},{allowCurrent:true})
     output=result.status==='queued'?`已提交到${this.conversations.displayName(owner,target)}，任务 ${result.data.taskId.slice(0,8)}。已排队，结果会在这里返回。`:'任务未确认入队，可查询管理操作 '+result.operationId+' 核对；未自动重试。'
    }else if(decision.action==='supplement'){
     if(!record.task)throw Error('ENTRY_NO_RUNNING_TASK')
     const result=await this.service.call(caller,'supplement_task',{...args,taskId:record.task.id,turnId:record.task.turnId,text:record.text,requestId:requestId(id)})
     output=['accepted','sent','confirmed'].includes(result.status)?'补充已提交给指定原任务。':`补充请求状态：${result.status}；没有新建任务。`
    }else if(decision.action==='status'){
     const status=await this.service.call(caller,'get_project_status',args)
     output=`${status.name}：${status.task?'任务执行中':status.state==='disconnected'?'当前未连接':'当前无执行任务'}；排队 ${status.queued} 项，待核对 ${status.uncertain} 项。`+(status.lastProgress?'\n最近进展：'+status.lastProgress:'')+'\n以上为执行状态，不代表项目完成度。'
    }else if(decision.action==='history'){
     const history=await this.service.call(caller,'get_session_history',args)
     output=history.messages.map(item=>`${item.role==='user'?'用户':'助手'}：${item.text}`).join('\n\n')||'本页没有历史文本。'
     if(history.nextCursor)output+='\n这里只展示一页历史，尚未读取完整历史。'
    }else{
     const result=await this.service.call(caller,'get_task_result',args)
     output=result.text+(result.nextCursor?'\n这里只展示结果的一部分。':'')+(result.attachments?.length?'\n原结果包含附件，本次仅查询文本，未重发文件。':'')
    }
   }
  }catch{output='这条请求未确认执行；目标或任务可能已变化，未转交其他项目或新建替代任务。请明确项目及要执行的操作。'}
  if(['status','history','result'].includes(decision.action))output=output.replace(/!?\[([^\]]*)\]\([^\n]*?\)/g,'$1')
  record.status='sending';await this.manager.save()
  if(!current())return true
  const delivery=await this.deliver(caller,output,{conversationControl:true,traceId:message._traceId,current})
  record.status=delivery?.status==='accepted'?'done':'delivery_unknown';await this.manager.save();this.jobs.acknowledge([id]);return true
 }
 async close(){this.closed=true;await this.classify?.close?.();await Promise.allSettled([...this.lanes.values()].map(lane=>lane.tail))}
}
