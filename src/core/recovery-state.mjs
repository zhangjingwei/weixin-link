export function recoveryText(record){
 if(!record)return ''
 const label=record.task?`任务 ${record.task.id}：${record.task.title}\n`:''
 const execution={waiting_attachment:'等待附件，任务尚未完成；直接发送附件即可继续，/stop 可取消',running:'仍在执行，请勿重复提交',completed:'执行已完成',failed:'执行失败',interrupted:'执行已停止',unknown:'执行结果未确认，请先 /recover 核对'}[record.execution]??'状态待核对'
 const delivery={deferred:'消息已保留，切换到此会话后按顺序展示',not_required:'无需额外通知',pending:'结果等待发送',accepted:'发送接口已接受（不代表已读）',failed:'发送失败，结果已保存，可用 /result 重发',unknown:'发送未确认，可用 /result 重发已保存结果',cancelled:'发送已取消，可用 /result 重试',recovered:'结果已恢复但未自动补发，可用 /result 查看',partial:'部分内容发送未确认，可用 /result 重发'}[record.delivery]??''
 return label+execution+(delivery?'\n'+delivery:'')
}
