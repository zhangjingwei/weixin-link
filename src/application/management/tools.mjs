const string=(maxLength=160)=>({type:'string',minLength:1,maxLength})
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum})
const project={projectId:string()},task={...project,taskId:string(),turnId:string()},write={requestId:string()}
const repeat={type:'object',properties:{frequency:{...string(),enum:['daily','weekly']},time:string(5),timeZone:string(100),weekdays:{type:'array',items:integer(1,7),minItems:1,maxItems:7,uniqueItems:true}},required:['frequency','time','timeZone'],additionalProperties:false}
const define=(name,description,properties={},required=[])=>{const mutation=/^(?:request_|create_|rename_|skip_|cancel_|submit_|supplement_)/.test(name);return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!mutation,destructiveHint:['request_task_stop','request_service_restart','request_upgrade'].includes(name),idempotentHint:!mutation||required.includes('requestId'),openWorldHint:false}}}
export const managementTools=[
 define('resolve_target','查找当前用户已登记的项目/会话；日常按 daily 身份定位。候选不是授权，歧义时询问。',{query:string(300)},['query']),
 define('list_projects','只读列出当前用户已登记的项目/会话，包含 daily 标识。'),
 define('get_project_progress','只读最近完成结果证据、当前任务、阻碍和排队后续工作，不猜测项目整体完成度。',project,['projectId']),
 define('get_project_status','读取本地任务、队列、待审批和管理操作状态；不是项目完成度。',project,['projectId']),
 define('get_session_history','只读历史文本分块分页；下一页为剩余文本或更早轮次，不重发附件。',{...project,cursor:string(4096)},['projectId']),
 define('get_management_operation','按操作编号查询当前用户的管理请求回执，不重放操作。',{operationId:string()},['operationId']),
 define('request_model_switch','明确要求切换时，为指定项目保存后续新任务的模型；不中断当前轮次，不更换供应商。先 list_models 核对模型标识。',{...project,model:string(),...write},['projectId','model','requestId']),
 define('request_queue_cancel_all','明确要求取消某项目全部排队任务时传查询得到的快照任务ID；只取消这些尚未开始的任务，不取消未来任务或停止运行任务。',{...project,taskIds:{type:'array',items:string(),minItems:1,maxItems:20,uniqueItems:true},...write},['projectId','taskIds','requestId']),
 define('request_queue_change','明确要求取消或优先处理某个排队任务时调用；仅影响尚未开始的精确任务，不停止运行任务。',{...project,taskId:string(),action:{...string(),enum:['cancel','prioritize']},...write},['projectId','taskId','action','requestId']),
 define('list_models','只查询底座模型，不切换。'),
 define('submit_project_task','明确执行请求才向其他项目提交新的文字任务，不切换当前入口。queued 只表示持久排队，不代表完成；当前项目直接执行，补充原任务用 supplement_task。',{...project,text:string(8000),...write},['projectId','text','requestId']),
 define('request_project_switch','明确要求切换时调用。异步请求，pending 不是已切换。',{...project,...write},['projectId','requestId']),
 define('supplement_task','补充指定原任务；任务过期则拒绝，绝不排队到下一轮。',{...task,text:string(8000),...write},['projectId','taskId','turnId','text','requestId']),
 define('request_task_stop','停止指定原任务并清空其队列；requested 不代表已确认停止。',{...task,...write},['projectId','taskId','turnId','requestId']),
 define('list_workspace_choices','列出来源项目当前目录及允许的子目录，返回五分钟有效的绑定选择凭据。',project,['projectId']),
 define('create_project','使用目录选择凭据新建项目记录；不切换、不连接、不创建文件夹。',{name:string(60),workspaceToken:string(4096),...write},['name','workspaceToken','requestId']),
 define('request_project_archive','明确要求归档或还原项目才调用；pending 不是完成，当前任务结束后复用原归档核对流程。',{...project,archived:{type:'boolean'},...write},['projectId','archived','requestId']),
 define('rename_project','命名指定项目，核对底座回执；不切换。',{...project,name:string(60),...write},['projectId','name','requestId']),
 define('search_session_history','有界搜索历史文本；返回覆盖轮数、时间和续页，不把局部无匹配说成全部没有。',{...project,query:string(300),cursor:string(4096)},['projectId','query']),
 define('list_project_tasks','列出指定项目持久任务的完整 taskId、可读标题与状态，不返回请求正文。',{...project,offset:integer(0,1000000),limit:integer(1,20)},['projectId']),
 define('get_task_result','只读最近结果或指定持久任务的历史结果，文本分页；不发送附件。',{...project,taskId:string(),cursor:string(4096)},['projectId']),
 define('request_result_redelivery','明确重发时使用查询返回的 resultToken；校验原快照，不重新生成文件。',{...project,resultToken:string(4096),...write},['projectId','resultToken','requestId']),
 define('request_task_reconciliation','核对指定未确认持久任务；仅查询原任务，不重执行。',{...project,taskId:string(),...write},['projectId','taskId','requestId']),
 define('get_entry_routing_status','只读当前用户入口识别耗时、回退次数及最近处理阶段，不含请求正文。'),
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
