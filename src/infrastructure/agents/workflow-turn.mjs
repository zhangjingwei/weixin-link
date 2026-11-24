// A short turn-level reminder keeps the discussion boundary visible after a
// long thread has accumulated context. The original user request stays intact.
const boundary='本轮根据用户请求和会话上文判断是普通问答、方案讨论还是明确实施。按已加载的对应 skill 处理，简短回复承接上文。'

function discussionIntent(request,mode){
 if(mode==='plan')return true
 const first=String(request??'').split(/\n来源会话中已商定的方案[（(]/u,1)[0].trim().slice(0,500)
 const execute=/(?:请|帮我|现在|直接|可以|继续).{0,20}(?:实现|修复|修改|开发|优化|落地|部署|发布|推送|更新本地实例)|(?:提交|推送|发布|部署|修复|修改).{0,12}(?:代码|分支|项目|问题|实例)/u
 const discuss=/(?:想|希望|打算|考虑).{0,18}(?:讨论|设计|规划|做个|做一个|方案)|(?:怎么|如何|怎样).{0,12}(?:设计|规划)|(?:比较|权衡).{0,16}(?:方案|做法)|(?:一起|先).{0,8}(?:聊聊|讨论)|(?:你觉得|你认为|你看|我们).{0,30}(?:是否需要|要不要|该不该|应不应该|值不值得|需不需要).{0,30}(?:做|开发|新增|增加|采用|设计|重做|单独|独立)|(?:方案|设计|机制|产品|功能|服务|消息|发送|投递|失败|需求|流程|策略).{0,35}(?:有什么|有何).{0,8}建议/u
 return discuss.test(first)&&!execute.test(first)
}

export function workflowTurnGuidance(request,mode) {
 return boundary+(discussionIntent(request,mode)?' 本轮有方案讨论意向，按已加载的 design-discussion skill 处理。':'')
}

export function discussionReplyPrefix(request,reply,mode){
 if(!reply||!discussionIntent(request,mode)||/[💡❓📋🛠️📦] Zero ·/u.test(reply.slice(0,160)))return ''
 return '💡 Zero · 方案讨论\n'
}
