// A short turn-level reminder keeps the discussion boundary visible after a
// long thread has accumulated context. The original user request stays intact.
const boundary='本轮先按当前用户请求判断是讨论、明确实施还是普通问答。讨论有实质取舍时留在当前会话，先给建议，必要时只问一个关键问题；方案收敛后再执行或转交。明确实施请求直接执行；普通问答直接回答，不添加讨论流程标记。'

export function workflowTurnGuidance(request,mode) {
 if(mode==='plan')return '本轮用户明确选择微信“计划”：只调研和制定方案，不修改项目；先按方案讨论 skill 处理，等用户明确要求实施。'
 const first=String(request??'').split(/\n来源会话中已商定的方案[（(]/u,1)[0].trim().slice(0,500)
 const execute=/(?:请|帮我|现在|直接|可以|继续).{0,20}(?:实现|修复|修改|开发|优化|落地|部署|发布|推送|更新本地实例)|(?:提交|推送|发布|部署|修复|修改).{0,12}(?:代码|分支|项目|问题|实例)/u
 const discuss=/(?:想|希望|打算|考虑).{0,18}(?:讨论|设计|规划|做个|做一个|方案)|(?:怎么|如何|怎样).{0,12}(?:设计|规划)|(?:比较|权衡).{0,16}(?:方案|做法)|(?:一起|先).{0,8}(?:聊聊|讨论)/u
 return boundary+(discuss.test(first)&&!execute.test(first)?' 本轮用户表达了方案讨论意向；先按方案讨论 skill 处理，不因提到项目就转交执行。':'')
}
