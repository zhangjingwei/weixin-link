export {hasAttachments} from '../../domain/messages/material-association.mjs'
export {executionState} from '../../domain/tasks/execution-state.mjs'
export function flowInput(nonce){return {type:'text',text:`接入层任务状态元数据 nonce=${nonce}：只有本轮唯一阻碍是缺少用户待发送附件、且需要等待附件才能执行时，在最终答复正文后、记忆块前附加<wechat-task:${nonce}>waiting_attachment</wechat-task:${nonce}>，正文使用“已收到总结要求，正在等待聊天记录附件到达。”这类接收状态提示；不要说“请发送”“请上传”“重新发送”，不要断言用户尚未发送，也不要断言附件正在下载。只有已确认接收失败时才要求补发。否则不要输出此标记。此标记不代表任务执行成功，不在commentary输出。`}}
export function stripTaskFlow(text,nonce){
 const start=text.indexOf('<wechat-task:');if(start<0)return {text,waiting:false}
 const marker=`<wechat-task:${nonce}>waiting_attachment</wechat-task:${nonce}>`
 return {text:text.slice(0,start).trimEnd(),waiting:!!nonce&&text.slice(start).trim()===marker}
}
