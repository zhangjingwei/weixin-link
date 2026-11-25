import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'

export async function projectProgress(context,owner,args){
 const entry=context.target(owner,args.projectId),status=context.snapshot(owner,entry),saved=context.manager.state.users[entry.key]??{},jobs=context.manager.submissions
 const queued=(jobs?.pending?.()??[]).filter(job=>job.owner===entry.key&&job.state==='pending').slice(0,5).map(job=>({taskId:job.id,title:taskDisplayTitle(job.input,job.input?.projectDispatch?.title)}))
 const port=context.conversations.backendPort
 let nativeQueue
 if(args.includeNative===true&&port?.queuedTasks&&saved.threadId&&!['claude','workbuddy','doubao','grok'].includes(context.manager.agentFor?.(entry.key))){
  try{nativeQueue=await context.conversations.withBackend(owner,rpc=>port.queuedTasks(rpc,saved.threadId,5))}
  catch{nativeQueue={unavailable:true,items:[]}}
 }
 const latest=[{identity:saved.resultIdentity,text:saved.lastReply},...[...(saved.resultArchive??[])].reverse().map(record=>({identity:record.identity,text:record.lastReply}))].find(record=>record.identity?.execution==='completed'&&typeof record.text==='string')
 const evidence=latest?[{kind:'completed_turn',taskOutcome:latest.identity.taskOutcome??'unknown',outcomeEvidence:latest.identity.outcomeEvidence??'execution_event',taskId:latest.identity.taskId,at:latest.identity.createdAt??null,excerpt:Array.from(latest.text).slice(0,1200).join(''),truncated:Array.from(latest.text).length>1200}]:[]
 const blockers=[]
 if(nativeQueue?.unavailable)blockers.push('暂时无法读取 Codex 会话待办')
 if(status.executionOwner==='desktop')blockers.push('当前由桌面接续，微信执行已暂停')
 if(status.uncertain)blockers.push('有执行或投递结果待核对的任务')
 if(status.pendingApprovals)blockers.push('有待用户审批的操作')
 if(saved.waitingAttachment)blockers.push('任务等待关联附件')
 if(saved.waitingInput)blockers.push('任务等待用户回答')
 return {projectId:entry.id,name:status.name,observedAt:status.observedAt,completed:evidence.length?evidence[0]:null,inProgress:status.task?{taskId:status.task.jobId,title:taskDisplayTitle(jobs?.get?.(status.task.jobId)?.input??saved.recovery?.task?.title??'当前任务',jobs?.get?.(status.task.jobId)?.input?.projectDispatch?.title)}:null,blockers,next:[...(nativeQueue?.items??[]),...queued],moreNativeTasks:nativeQueue?.more,nativeProgress:status.task?status.lastProgress??null:null,turnModel:status.turnModel??null,goal:status.goal??null,evidence,scope:'最近保留的完成结果及当前本地执行状态；不代表项目整体完成度'}
}
