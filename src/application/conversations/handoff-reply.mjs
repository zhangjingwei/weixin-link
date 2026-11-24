// A source turn finishing is not the same event as the target task finishing.
// Use persisted routing and queue evidence, never the model's summary, for the
// source conversation's final status.
export function handoffReply(state,jobs,session){
 const operations=(state.managementOperations??[]).filter(op=>op.name==='route_conversation_request'&&op.caller===session.userId&&(
  op.sourceTaskId===session.taskId||!op.sourceTaskId&&Number.isFinite(session.startedAt)&&op.createdAt>=session.startedAt
 ))
 if(!operations.length)return null
 const op=operations.findLast(op=>op.status==='queued')??operations.at(-1)
 if(op.status==='unknown'||op.status==='executing'||op.status==='pending')return '转交结果尚未确认，无法判断目标会话是否已接收；不会自动重复提交。请核对任务状态。'
 if(op.status==='rejected'||op.status==='not_executed')return '转交未成功，目标会话没有确认接收这项任务。请核对目标会话后再试。'
 if(op.status!=='queued')return null
 const job=op.data?.taskId&&jobs?.get?.(op.data.taskId)
 if(!job||job.id!==op.data.taskId||job.input?.projectDispatch?.operationId!==op.id)
  return '转交回执与目标任务记录当前无法对应，任务状态待核对；请查看目标会话。'
 const raw=String(op.data?.name??'').replace(/[\x00-\x1f\x7f【】]/g,' ').replace(/\s+/g,' ').trim()
 const name=raw&&Array.from(raw).length<=12?raw:'目标会话'
 const target=name==='目标会话'?name:`${name}会话`
 if(job.state==='pending')return `已交给${target}，目前排队中；结果将在目标会话返回。`
 if(['starting','bound','submitted','waiting_desktop'].includes(job.state))return `已交给${target}，正在处理；结果将在目标会话返回。`
 if(job.state==='done')return job.outcome==='completed'
  ?`已交给${target}，目标任务已结束；请查看目标会话的结果。`
  :`已交给${target}，目标任务已结束，但结果未确认成功；请查看目标会话的回报。`
 if(job.state==='cancelled')return '转交曾确认入队，但目标任务随后取消或未执行；请查看目标会话。'
 return '转交曾确认入队，但目标任务的执行或投递结果待核对；请查看目标会话。'
}
