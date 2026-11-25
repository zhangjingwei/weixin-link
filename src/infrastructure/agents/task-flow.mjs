export function flowInput(nonce){return {type:'text',text:`接入层任务身份 nonce=${nonce}。需要等待用户附件或回答时，先 get_conversation_context，再调用 request_task_input，传入本轮 sourceTaskId、turnId 和 kind。只在工具确认后说明等待；不要输出任何任务状态标签。明确实施任务的结果用 report_task_result 结构化报告；普通问答不必报告。模型轮次结束不等于业务任务完成，正文不能设置任务状态。`}}
export function stripTaskFlow(text,nonce){
 const marker=`<wechat-task:${nonce}>waiting_attachment</wechat-task:${nonce}>`
 return {text:nonce&&text.endsWith(marker)?text.slice(0,-marker.length).trimEnd():text,waiting:false}
}
