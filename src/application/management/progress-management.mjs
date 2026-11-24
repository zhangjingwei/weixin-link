import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'

export function projectProgress(context,owner,args){
 const entry=context.target(owner,args.projectId),status=context.snapshot(owner,entry),saved=context.manager.state.users[entry.key]??{},jobs=context.manager.submissions
 const queued=(jobs?.pending?.()??[]).filter(job=>job.owner===entry.key&&job.state==='pending').slice(0,5).map(job=>({taskId:job.id,title:taskDisplayTitle(job.input,job.input?.projectDispatch?.title)}))
 const latest=[{identity:saved.resultIdentity,text:saved.lastReply},...[...(saved.resultArchive??[])].reverse().map(record=>({identity:record.identity,text:record.lastReply}))].find(record=>record.identity?.execution==='completed'&&typeof record.text==='string')
 const evidence=latest?[{kind:'completed_result',taskId:latest.identity.taskId,at:latest.identity.createdAt??null,excerpt:Array.from(latest.text).slice(0,1200).join(''),truncated:Array.from(latest.text).length>1200}]:[]
 const blockers=[]
 if(status.executionOwner==='desktop')blockers.push('当前由桌面接续，微信执行已暂停')
 if(status.uncertain)blockers.push('有执行或投递结果待核对的任务')
 if(status.pendingApprovals)blockers.push('有待用户审批的操作')
 if(saved.waitingAttachment)blockers.push('任务等待关联附件')
 return {projectId:entry.id,name:status.name,observedAt:status.observedAt,completed:evidence.length?evidence[0]:null,inProgress:status.task?{taskId:status.task.jobId,title:taskDisplayTitle(jobs?.get?.(status.task.jobId)?.input??saved.recovery?.task?.title??'当前任务',jobs?.get?.(status.task.jobId)?.input?.projectDispatch?.title)}:null,blockers,next:queued,evidence,scope:'最近保留的完成结果及当前本地执行状态；不代表项目整体完成度'}
}
export function progressText(value){
 const result=value.completed
 return `${value.name} · 进展\n已完成：${result?'最近一次已完成任务的结果节选（'+(result.at??'时间未记录')+'）：\n'+result.excerpt+(result.truncated?'\n（节选）':''):'没有可核实的近期完成结果。'}\n进行中：${value.inProgress?.title??'当前无执行任务'}\n阻碍：${value.blockers.join('；')||'本地未记录明确阻碍，不能据此认定项目没有问题'}\n下一步：${value.next.map(task=>task.title).join('；')||'没有已排队任务，后续计划未确认'}\n查询时间：${value.observedAt}\n${value.scope}`
}
