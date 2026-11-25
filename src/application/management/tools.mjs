const string=(maxLength=160)=>({type:'string',minLength:1,maxLength})
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum})
const project={projectId:string()},task={...project,taskId:string(),turnId:string()},write={requestId:string()}
const repeat={type:'object',properties:{frequency:{...string(),enum:['daily','weekly']},time:string(5),timeZone:string(100),weekdays:{type:'array',items:integer(1,7),minItems:1,maxItems:7,uniqueItems:true}},required:['frequency','time','timeZone'],additionalProperties:false}
const define=(name,description,properties={},required=[])=>{const mutation=/^(?:request_|create_|rename_|skip_|cancel_|submit_|supplement_|open_|route_|associate_)/.test(name);return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!mutation,destructiveHint:['request_task_stop','request_service_restart','request_upgrade','request_desktop_handoff','request_desktop_return','request_project_delete','request_thread_revert','request_section_delete','request_queue_remove'].includes(name),idempotentHint:!mutation||required.includes('requestId'),openWorldHint:false}}}
const thread={threadId:string()},section={sectionId:string()},queued={...thread,queuedSubmissionId:string()}
const page={cursor:string(4096),limit:integer(1,50)}
const ids={type:'array',items:string(),minItems:1,maxItems:100,uniqueItems:true}
export const managementTools=[
 define('get_thread_goal','查询会话原生长任务目标、状态和预算。',thread,['threadId']),
 define('request_goal_update','设置长任务目标或调整状态和预算。',{...thread,objective:string(4000),status:{...string(),enum:['active','paused','complete']},tokenBudget:integer(1,1000000000),...write},['threadId','status','requestId']),
 define('request_goal_clear','清除指定会话的长任务目标。',{...thread,...write},['threadId','requestId']),
 define('get_account_usage','读取 Codex 账号用量；可指定 threadId 查该会话估算用量。',thread),
 define('get_account_limits','读取 Codex 账号额度窗口、使用比例和重置时间。'),
 define('list_thread_sections','列出原生会话分组。',page),
 define('create_thread_section','创建原生会话分组。',{name:string(120),...write},['name','requestId']),
 define('request_section_rename','修改原生会话分组名称。',{...section,name:string(120),...write},['sectionId','name','requestId']),
 define('request_section_delete','删除指定原生会话分组。',{...section,...write},['sectionId','requestId']),
 define('request_thread_move','移动会话到分组；省略 sectionId 移出分组。',{...thread,...section,beforeThreadId:string(),...write},['threadId','requestId']),
 define('request_project_move','调整原生项目顺序。',{...project,beforeProjectId:string(),...write},['projectId','requestId']),
 define('request_project_import','按已选目录导入原生项目，可关联已有会话。',{workspaceToken:string(4096),name:string(60),threads:ids,...write},['name','workspaceToken','requestId']),
 define('request_project_delete','明确要求删除指定原生项目时使用。',{...project,...write},['projectId','requestId']),
 define('request_thread_revert','回退指定会话至指定轮次之前；只改变对话历史，工作区文件保留。',{...thread,beforeTurnId:string(),...write},['threadId','beforeTurnId','requestId']),
 define('list_thread_queue','读取桌面和微信共享的 Codex 会话待办。',{...thread,...page},['threadId']),
 define('request_queue_add','添加可自动启动的 Codex 待办，空闲时可能立即执行。',{...thread,text:string(8000),...write},['threadId','text','requestId']),
 define('request_queue_edit','编辑共享待办。',{...queued,text:string(8000),...write},['threadId','queuedSubmissionId','text','requestId']),
 define('request_queue_remove','删除指定共享待办。',{...queued,...write},['threadId','queuedSubmissionId','requestId']),
 define('request_queue_reorder','按已核对的待办 ID 列表调整顺序。',{...thread,queuedSubmissionIds:ids,...write},['threadId','queuedSubmissionIds','requestId']),
 define('request_queue_start','启动指定共享待办。',{...queued,...write},['threadId','queuedSubmissionId','requestId']),
 define('get_desktop_status','查询同机桌面接续支持和当前交接状态；不打开客户端。'),
 define('request_desktop_handoff','用户明确要求在桌面继续时调用；收到回执并空闲后打开个人 Codex 桌面端，暂停本账号微信执行。桌面可见性需人工确认。',{...project,...write},['projectId','requestId']),
 define('request_desktop_return','用户要求返回微信时调用；核对原会话空闲且可重新取得写入权。',{...project,...write},['projectId','requestId']),
 define('resolve_target','查找当前用户已登记的项目/会话。候选不是授权，歧义时询问。',{query:string(300)},['query']),
 define('list_projects','查询 Codex 项目（nativeProjects 包含 id、name、roots，null 表示不可用）。projects 是微信会话绑定，供派发和切换使用。'),
 define('get_project_progress','只读最近完成结果证据、当前任务、阻碍和排队后续工作，不猜测项目整体完成度。',project,['projectId']),
 define('get_project_status','读取本地任务、队列、待审批和管理操作状态；不是项目完成度。',project,['projectId']),
 define('get_session_history','只读历史文本分块分页；下一页为剩余文本或更早轮次，不重发附件。',{...project,cursor:string(4096)},['projectId']),
 define('get_management_operation','按操作编号查询当前用户的管理请求回执，不重放操作。',{operationId:string()},['operationId']),
 define('request_model_switch','明确要求切换时，为指定项目保存后续新任务的模型；不中断当前轮次，不更换供应商。先 list_models 核对模型标识。',{...project,model:string(),...write},['projectId','model','requestId']),
 define('request_queue_cancel_all','明确要求取消某项目全部排队任务时传查询得到的快照任务ID；只取消这些尚未开始的任务，不取消未来任务或停止运行任务。',{...project,taskIds:{type:'array',items:string(),minItems:1,maxItems:20,uniqueItems:true},...write},['projectId','taskIds','requestId']),
 define('request_queue_change','明确要求取消或优先处理某个排队任务时调用；仅影响尚未开始的精确任务，不停止运行任务。',{...project,taskId:string(),action:{...string(),enum:['cancel','prioritize']},...write},['projectId','taskId','action','requestId']),
 define('list_models','只查询底座模型，不切换。'),
 define('submit_project_task','明确执行请求才向其他项目提交新的文字任务，不切换当前入口。queued 只表示持久排队，不代表完成；当前项目直接执行，补充原任务用 supplement_task。',{...project,text:string(8000),...write},['projectId','text','requestId']),
 define('request_project_switch','用户要求切换，或模型根据原始执行请求确认应接续已查询会话时调用。只改变后续消息导航，不转交本轮任务；pending 不是已切换。',{...project,...write},['projectId','requestId']),
 define('supplement_task','补充指定原任务；任务过期则拒绝，绝不排队到下一轮。',{...task,text:string(8000),...write},['projectId','taskId','turnId','text','requestId']),
 define('request_task_stop','停止指定原任务并清空其队列；requested 不代表已确认停止。',{...task,...write},['projectId','taskId','turnId','requestId']),
 define('list_workspace_choices','列出来源项目当前目录及允许的子目录，返回五分钟有效的绑定选择凭据。',project,['projectId']),
 define('create_project','使用目录选择凭据创建 Codex 原生项目；不切换、不连接、不创建文件夹。',{name:string(60),workspaceToken:string(4096),...write},['name','workspaceToken','requestId']),
 define('list_project_sessions','通过 Codex app-server 分页查询未归档会话；省略 nativeProjectId 查询所有项目和独立会话。',{nativeProjectId:string(),cursor:string(4096)}),
 define('open_conversation','模型根据原始请求和 MCP 查询结果判断新建或复用会话。threadId 接续真实会话（可无项目）；省略 threadId 新建，独立会话须提供目录凭据，项目会话用 nativeProjectId。只连接和返回微信操作编号，不执行任务、不切换。',{nativeProjectId:string(),threadId:string(),workspaceToken:string(4096),...write},['requestId']),
 define('route_conversation_request','模型确认需要交给另一会话执行时，原样转交本轮持久请求及引用和本轮附件；依赖此前讨论时用 agreedPlan 补充已定方案；先 open_conversation 或 list_projects 核对目标 threadId、projectId。sourceTaskId 来自 get_conversation_context，禁止转发已分流任务。queued 不代表完成，也不切换导航。',{...project,threadId:string(),sourceTaskId:string(),agreedPlan:string(8000),...write},['projectId','threadId','sourceTaskId','requestId']),
 define('get_conversation_repository','只读核实指定真实会话目录所属 Git 仓库与 worktree 共同身份，返回五分钟有效的仓库凭据。不是 Git 仓库返回 null；不按目录名推断。',thread,['threadId']),
 define('associate_repository_conversations','模型判断多个会话应归同一仓库项目时调用。先获取仓库凭据，再指定真实会话 ID；nativeProjectId 复用已有项目，否则按 name 创建。核实仓库相同，保留 worktree 目录，拒绝覆盖已有其他项目归属；不合并历史、不执行代码、不切换。',{workspaceToken:string(4096),nativeProjectId:string(),name:string(60),threadIds:{type:'array',items:string(),minItems:1,maxItems:20,uniqueItems:true},...write},['workspaceToken','threadIds','requestId']),
 define('get_conversation_context','读取本次模型所在会话、持久任务 ID、是否已分流及本轮材料摘要；用于自主决定是否需要查询、新建或接续其他会话。'),
 define('create_project_session','为指定原生项目创建新会话，或按 threadId 接续已有会话。多根项目新建时选择一个返回过的 workspace。返回微信操作编号，可用于切换。',{nativeProjectId:string(),threadId:string(),workspace:string(4096),...write},['nativeProjectId','requestId']),
 define('request_project_archive','明确要求归档或还原微信绑定的会话才调用；pending 不是完成，当前任务结束后复用原归档核对流程。',{...project,archived:{type:'boolean'},...write},['projectId','archived','requestId']),
 define('rename_project','修改 Codex 项目名称。projectId 可用 list_projects 返回的原生 ID 或已绑定会话编号。',{...project,name:string(60),...write},['projectId','name','requestId']),
 define('search_sessions','按话题在个人 Codex 会话中搜索；默认未归档，archived=true 仅查已归档。返回会话 ID、匹配片段和续页。',{query:string(300),archived:{type:'boolean'},cursor:string(4096)},['query']),
 define('search_session_history','在一条 Codex 会话中搜索原文。指定微信绑定 projectId 或原生 threadId，沿 nextCursor 续查。',{...project,threadId:string(),query:string(300),cursor:string(4096)},['query']),
 define('list_project_tasks','列出指定项目持久任务的完整 taskId、可读标题与状态，不返回请求正文。',{...project,offset:integer(0,1000000),limit:integer(1,20)},['projectId']),
 define('get_task_result','只读最近结果或指定持久任务的历史结果，文本分页；不发送附件。',{...project,taskId:string(),cursor:string(4096)},['projectId']),
 define('request_result_redelivery','明确重发时使用查询返回的 resultToken；校验原快照，不重新生成文件。',{...project,resultToken:string(4096),...write},['projectId','resultToken','requestId']),
 define('request_task_reconciliation','核对指定未确认持久任务；仅查询原任务，不重执行。',{...project,taskId:string(),...write},['projectId','taskId','requestId']),
 define('get_service_status','只读当前账号服务的就绪、忙闲和维护排空状态。'),
 define('get_installation_status','只读当前账号安装和推理验收记录，不发起推理或登录。'),
 define('get_diagnostics','只读当前账号脱敏诊断汇总和最近错误，不返回原始日志或聊天内容。'),
 define('get_usage_guide','读取自然语言使用说明及模型不可用时的应急命令。',{language:{...string(2),enum:['zh','en']}}),
 define('get_maintenance_status','只读当前账号重启及共享安装升级的真实工作进程状态。'),
 define('request_service_restart','用户明确要求重启才调用；仅当前账号，MCP 回执后安排空闲重启，pending/scheduled 不是完成。',write,['requestId']),
 define('request_upgrade','用户明确要求升级才调用；影响共享安装中的账号，绑定刚检查的版本凭据，MCP 回执后安排空闲升级。',{updateToken:string(4096),...write},['updateToken','requestId']),
 define('check_updates','只读检查更新并返回绑定当前用户和具体版本的跳过凭据；不升级。'),
 define('skip_update','跳过版本凭据对应的确切版本；不会跳过后来出现的新版本。',{updateToken:string(4096),...write},['updateToken','requestId']),
 define('create_schedule','创建提醒或指定项目的定时任务。at 必须有时区偏移；at/repeat 二选一；请求去重。',{...project,kind:{...string(),enum:['reminder','task']},text:string(1000),at:string(40),repeat,timeZone:string(100),...write},['projectId','kind','text','requestId']),
 define('list_schedules','列出当前用户计划并显示目标项目、状态、时区；不改变活动项目。',{offset:integer(0,500),limit:integer(1,10)},[]),
 define('cancel_schedule','取消指定计划的未来触发；不会停止已提交的执行任务。',{scheduleId:string(),...write},['scheduleId','requestId']),
]
function valid(schema,value){
 if(schema.enum&&!schema.enum.includes(value))return false
 if(schema.type==='string')return typeof value==='string'&&value.trim().length>=schema.minLength&&value.length<=schema.maxLength
 if(schema.type==='boolean')return typeof value==='boolean'
 if(schema.type==='integer')return Number.isInteger(value)&&value>=schema.minimum&&value<=schema.maximum
 if(schema.type==='array')return Array.isArray(value)&&value.length>=schema.minItems&&value.length<=schema.maxItems&&(!schema.uniqueItems||new Set(value).size===value.length)&&value.every(v=>valid(schema.items,v))
 if(schema.type==='object')return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(schema.properties,k))&&(schema.required??[]).every(k=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>valid(schema.properties[k],v))
 return false
}
export function validateManagementCall(name,args){const spec=managementTools.find(t=>t.name===name);if(!spec||!valid(spec.inputSchema,args))throw Error('MANAGEMENT_INVALID_ARGUMENTS');return spec}
