import {createHash} from 'node:crypto'
import {submitProjectTask} from '../management/project-task-management.mjs'

export const entryRequestId=id=>{const h=createHash('sha256').update('entry-route:'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export async function entryAction(context,message,record,step,index){
 const {service,manager,conversations}=context,owner=message._conversationOwner??message.userId,caller=message.userId,args={projectId:step.projectId},requestId=entryRequestId(index?message._ingressId+':'+index:message._ingressId)
 if(step.action==='clarify')return step.question||'这条请求要交给哪个项目？'
 if(step.action==='desktop_status'){
  const state=await service.call(caller,'get_desktop_status',{})
  if(state.handoff)return '桌面接续状态：'+({waiting:'等待当前工作结束；微信新任务已暂停',launching:'正在请求打开，尚未确认桌面显示',desktop:'已请求在桌面打开；微信新任务已暂停，桌面显示仍需你确认',launch_unknown:'打开结果未确认；微信执行仍暂停'}[state.handoff.phase]??'需要核对')+'。在桌面释放这条会话后可说“回到微信继续”。'
  return state.enabled?'桌面接续已启用，目前仍由微信处理任务。':state.supported?'桌面接续尚未就绪，请在安装电脑检查是否启用并已安装支持的客户端。':'当前系统暂不支持桌面接续。'
 }
 const target=service.target(owner,step.projectId)
 if((manager.state.users[target.key]?.threadId??null)!==step.threadId)throw Error('ENTRY_TARGET_CHANGED')
 if(step.action==='desktop_open'||step.action==='desktop_return'){
  const result=await service.call(caller,step.action==='desktop_open'?'request_desktop_handoff':'request_desktop_return',{...args,requestId})
  if(result.status==='pending'){record.activations??=[];if(!record.activations.includes(result.operationId))record.activations.push(result.operationId)}
  return result.status==='pending'?'已安排桌面接续，等待当前工作结束。':result.status==='confirmed'?'已回到微信，可以继续处理任务。':'接续尚未完成，请先在桌面关闭这条会话，再核对接续状态。'
 }
 if(step.action==='task'){
  if(manager.state.desktopHandoff)throw Error('MANAGEMENT_DESKTOP_EXECUTION_PAUSED')
  const dependencies=step.dependsOn.map(i=>record.receipts?.[i]?.taskId)
  if(dependencies.some(id=>!id))throw Error('ENTRY_DEPENDENCY_UNCONFIRMED')
  const text=record.steps.length>1?'用户原始请求（只有下方指定片段属于本项目任务，其他项目仅作上下文）：\n'+record.text+'\n本任务只执行以下原文片段，并遵守原请求中的共同约束：\n'+step.text:record.text
  let preparedInput=step.useAttachments===true||step.useAttachments===undefined&&record.steps.length===1?record.preparedInput:record.preparedInput?.references?{references:record.preparedInput.references}:undefined
  if(preparedInput?.attachments?.length&&context.prepareHandoff)preparedInput=await context.prepareHandoff({sourceKey:record.materialSourceKey??caller,targetKey:target.key,ingressId:record.materialIngressId??message._ingressId,input:preparedInput})
  const result=await submitProjectTask(service,owner,caller,{...args,text,requestId},{allowCurrent:true,title:step.title,dependencies,preparedInput})
  record.receipts??={};record.receipts[index]=result.data
  return result.status==='queued'?'':'任务未确认入队；未自动重试。'
 }
 if(step.action==='supplement'||step.action==='stop'){
  if(!step.task)throw Error('ENTRY_NO_RUNNING_TASK')
  const result=await service.call(caller,step.action==='stop'?'request_task_stop':'supplement_task',{...args,taskId:step.task.id,turnId:step.task.turnId,...step.action==='supplement'?{text:record.text}:{},requestId})
  if(result.status==='pending'){record.activations??=[];if(!record.activations.includes(result.operationId))record.activations.push(result.operationId)}
  return step.action==='stop'?(result.status==='pending'||result.status==='requested'?'正在请求停止这个任务，是否已停止还需等待确认。':'这次停止操作尚未确认，请先核对任务状态。'):(result.status==='accepted'?'补充内容已交给正在进行的任务。':'补充内容尚未确认送达，请先核对任务状态。')
 }
 if(step.action==='cancel_all'){
  const taskIds=(step.queuedTasks??[]).map(task=>task.taskId)
  if(!taskIds.length)return '没有可取消的未开始任务。'
  const result=await service.call(caller,'request_queue_cancel_all',{...args,taskIds,requestId})
  return result.status==='confirmed'?`已取消 ${result.data.cancelled} 项等待中的任务，不影响运行任务和之后的新任务。`:'任务列表已变化，未批量取消。'
 }
 if(['cancel','prioritize'].includes(step.action)){
  if(!step.taskId||!step.queuedTasks?.some(task=>task.taskId===step.taskId))return '未定位到唯一的未开始任务，请说明要操作的任务名称。'
  const result=await service.call(caller,'request_queue_change',{...args,taskId:step.taskId,action:step.action,requestId})
  return result.status==='confirmed'?(step.action==='cancel'?'已取消指定排队任务，未停止运行任务。':'已将指定排队任务提前，未打断运行任务。'):'排队任务已变化，未执行该操作。'
 }
 if(step.action==='routing_status'){const state=await service.call(caller,'get_entry_routing_status',{});return `入口识别模型：${state.classifier?.model??'尚未产生识别记录'}；推理档：${state.classifier?.reasoningEffort??'未记录'}；速度：${state.classifier?.serviceTier??'未记录'}。\n已识别 ${state.metrics.classified??0} 条，回退 ${state.metrics.fallbacks??0} 条，最近耗时 ${state.metrics.lastLatencyMs??'未记录'} 毫秒。未完成分流记录 ${state.pending} 条（不等同于活跃进程）。`}
 if(step.action==='status')return context.progress(caller,args)
 if(step.action==='history'){
  const history=await service.call(caller,'get_session_history',args)
  return (history.messages.map(item=>`${item.role==='user'?'用户':'助手'}：${item.text}`).join('\n\n')||'本页没有历史文本。')+(history.nextCursor?'\n这里只展示一页历史，尚未读取完整历史。':'')
 }
 const result=await service.call(caller,'get_task_result',args)
 return result.text+(result.nextCursor?'\n这里只展示结果的一部分。':'')+(result.attachments?.length?'\n原结果包含附件，本次仅查询文本，未重发文件。':'')
}
