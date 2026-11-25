// These requests belong to the current model turn, including its MCP pagination context.
export function isCatalogQuestion(text){
 return /^(?:请|帮我)?(?:看看|列出|查看)?(?:我)?(?:当前|目前|现在)?的?(?:都?有哪些|所有的?)(?:项目|会话|对话)[？?。]?$|^(?:看看|列出|查看)?(?:电脑|桌面|终端)(?:上|端)?最近的?(?:会话|对话)[。？?]?$|^更多会话[？?。]?$/u.test(text?.trim())
}

// A bare result lookup should preserve an open prompt and must not replay a failed delivery.
export function isResultLookup(text){
 return /^(?:结果|result)[。？！!?]?$/iu.test(text?.trim())
}

// Exact read requests can still inspect local receipts when the executor cannot resume.
function resultTopic(text){
 const value=text?.trim()
 if(/^(?:看看刚才的结果|核对刚才的任务有没有完成)[。？！!?]?$/.test(value))return ''
 return /^(?:请)?(?:看看|查看)([^，,。？！!?\n]{1,60})的结果[。？！!?]?$/.exec(value)?.[1]?.trim()??null
}

export function recordedFailure(jobs,owner,text){
 const topic=resultTopic(text)
 if(topic===null||!jobs.matchingTasks)return null
 for(const job of jobs.matchingTasks(owner,topic)){
  if(resultTopic(job.text)!==null)continue
  if(job.state==='uncertain')return '该任务的本地记录仍是“结果未确认”，目前没有可确认的完成结果。'
  if(job.state==='cancelled'&&job.outcome==='not_submitted')return '该任务在提交前被取消，执行器没有收到本次任务。'
  break
 }
 return null
}
