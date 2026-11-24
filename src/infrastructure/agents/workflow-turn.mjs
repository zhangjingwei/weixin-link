// A short turn-level reminder keeps the discussion boundary visible after a
// long thread has accumulated context. The original user request stays intact.
const boundary='本轮根据用户请求和会话上文判断是普通问答、方案讨论还是明确实施。按已加载的对应 skill 处理，简短回复承接上文。回复先给当前需要的结论、下一步或阻碍；不复述已知背景，不重复会话标题、模型名或命令与文件统计。若多个项目或任务都可能是所指且会改变操作，只问一个必要问题。'
const requestHead=request=>String(request??'').split(/来源会话中已商定的方案[（(]/u,1)[0].trim().slice(0,500)

function shortReplyGuidance(request){
 const text=requestHead(request)
 if(/^(?:对|是|是的|同意|可以|好|好的|行)[。.!！]?$/u.test(text))
  return ' 这是对最近一项明确建议或选择的简短确认，先从本会话上文确定所指；不当作新议题。若原请求已授权落地且关键选择已定，沿原目标继续；若原本只在讨论，留在本会话收束或继续讨论，不仅凭确认转交执行。'
 if(/^继续[。.!！]?$/u.test(text))
  return ' 这是承接上文的继续请求。只推进最近一项可确定且已获授权的工作；若此前只在讨论，继续讨论，不擅自转交执行。'
 if(/^(?:结果|result)[。?!！？]?$/iu.test(text))
  return ' 这是最近任务的结果或状态查询。沿本会话已确认的任务归属核对现有结果，不新建任务、不重做；不能唯一确定目标时只问一个必要问题。'
 if(/^(?:收到|明白了)[。.!！]?$/u.test(text))
  return ' 这是接收确认，不当作新议题或新的实施授权；无需重复已知内容。'
 return ''
}

function discussionIntent(request,mode){
 if(mode==='plan')return true
 const first=requestHead(request)
 const execute=/(?:请|帮我|现在|直接|可以|继续).{0,20}(?:实现|修复|修改|开发|优化|落地|部署|发布|推送|更新本地实例)|(?:提交|推送|发布|部署|修复|修改).{0,12}(?:代码|分支|项目|问题|实例)/u
 const discuss=/(?:想|希望|打算|考虑).{0,18}(?:讨论|设计|规划|做个|做一个|方案)|(?:怎么|如何|怎样).{0,12}(?:设计|规划)|(?:比较|权衡).{0,16}(?:方案|做法)|(?:一起|先).{0,8}(?:聊聊|讨论)|(?:你觉得|你认为|你看|我们).{0,30}(?:是否需要|要不要|该不该|应不应该|值不值得|需不需要).{0,30}(?:做|开发|新增|增加|采用|设计|重做|单独|独立)|(?:方案|设计|机制|产品|功能|服务|消息|发送|投递|失败|需求|流程|策略).{0,35}(?:有什么|有何).{0,8}建议/u
 return discuss.test(first)&&!execute.test(first)
}

export function workflowTurnGuidance(request,mode) {
 return boundary+shortReplyGuidance(request)+(discussionIntent(request,mode)?' 本轮有方案讨论意向，按已加载的 design-discussion skill 处理。':'')
}

export function discussionReplyPrefix(request,reply,mode){
 if(!reply||!discussionIntent(request,mode)||/[💡❓📋🛠️📦] Zero ·/u.test(reply.slice(0,160)))return ''
 return '💡 Zero · 方案讨论\n'
}
