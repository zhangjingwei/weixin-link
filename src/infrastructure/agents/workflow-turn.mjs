// A short turn-level reminder keeps the discussion boundary visible after a
// long thread has accumulated context. The original user request stays intact.
const boundary='本轮结合当前用户请求和会话上文判断是讨论、明确实施还是普通问答。讨论有实质取舍时留在当前会话，先给建议，必要时只问一个关键问题；接续讨论的简短追问沿用上文，方案收敛后再执行或转交。明确实施请求直接执行；普通问答直接回答，不添加讨论流程标记。'

function discussionIntent(request,mode){
 if(mode==='plan')return true
 const first=String(request??'').split(/\n来源会话中已商定的方案[（(]/u,1)[0].trim().slice(0,500)
 const execute=/(?:请|帮我|现在|直接|可以|继续).{0,20}(?:实现|修复|修改|开发|优化|落地|部署|发布|推送|更新本地实例)|(?:提交|推送|发布|部署|修复|修改).{0,12}(?:代码|分支|项目|问题|实例)/u
 const discuss=/(?:想|希望|打算|考虑).{0,18}(?:讨论|设计|规划|做个|做一个|方案)|(?:怎么|如何|怎样).{0,12}(?:设计|规划)|(?:比较|权衡).{0,16}(?:方案|做法)|(?:一起|先).{0,8}(?:聊聊|讨论)|(?:你觉得|你认为|你看|我们).{0,30}(?:是否需要|要不要|该不该|应不应该|值不值得|需不需要).{0,30}(?:做|开发|新增|增加|采用|设计|重做|单独|独立)/u
 return discuss.test(first)&&!execute.test(first)
}

export function workflowTurnGuidance(request,mode) {
 if(mode==='plan')return '本轮用户明确选择微信“计划”：只调研和制定方案，不修改项目；先按方案讨论 skill 处理，等用户明确要求实施。'
 return boundary+(discussionIntent(request,mode)?' 本轮用户表达了方案讨论意向；先按方案讨论 skill 处理，不因提到项目就转交执行。直接给建议也使用该 skill 的可见讨论标记，不为标记强行追问或宣称共识。':'')
}

export function discussionReplyPrefix(request,reply,mode){
 if(!reply||!discussionIntent(request,mode)||/[💡❓📋🛠️📦] Zero ·/u.test(reply.slice(0,160)))return ''
 return '💡 Zero · 方案讨论\n'
}
