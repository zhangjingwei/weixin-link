export function recoveryText(record){
 if(!record)return ''
 const label=record.task?`任务 ${record.task.id}：${record.task.title}\n`:''
 const execution={waiting_attachment:'等待附件，任务尚未完成；直接发送附件即可继续，也可以说“停止这个任务”',running:'仍在执行，请勿重复提交',completed:'执行已完成',failed:'执行失败',interrupted:'执行已停止',unknown:'执行结果未确认，你可以说“核对上次任务有没有完成”'}[record.execution]??'状态待核对'
 const delivery={deferred:'消息已保留，你可以说“看看这个项目的结果”',not_required:'无需额外通知',pending:'结果等待发送',accepted:'已提交发送，尚未确认你是否收到',failed:'发送失败，结果已保存，你可以说“把上次的结果再发一次”',unknown:'发送未确认，你可以说“把上次的结果再发一次”',cancelled:'发送已取消，你可以说“把上次的结果再发一次”',recovered:'结果已恢复但未自动补发，你可以说“看看上次的结果”',partial:'部分内容发送未确认，你可以说“把上次的结果再发一次”'}[record.delivery]??''
 return label+execution+(delivery?'\n'+delivery:'')
}
