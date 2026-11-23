const string=(maxLength=160)=>({type:'string',minLength:1,maxLength})
const project={projectId:string()},task={...project,taskId:string(),turnId:string()}
const define=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!name.startsWith('request_')&&name!=='supplement_task',destructiveHint:name==='request_task_stop',idempotentHint:name!=='supplement_task',openWorldHint:false}})
export const managementTools=[
 define('resolve_target','查找当前用户已登记的项目/会话。候选不是执行授权；歧义时询问用户。',{query:string(300)},['query']),
 define('list_projects','只读列出当前用户已登记的项目/会话，不扫描其他人的 Codex 目录。'),
 define('get_project_status','读取本地任务、排队、结果和管理操作状态；不代表项目完成度。',project,['projectId']),
 define('get_session_history','只读历史文本分块分页；本页从早到晚，下一页更早；附件不重发。',{...project,cursor:string(4096)},['projectId']),
 define('list_models','只查询底座返回的模型，不切换模型。'),
 define('request_project_switch','用户明确要求切换时调用。异步请求；pending 不是已切换。',{...project,requestId:string()},['projectId','requestId']),
 define('supplement_task','将补充交给指定原任务；任务过期则拒绝，绝不排队到下一轮。',{...task,text:string(8000),requestId:string()},['projectId','taskId','turnId','text','requestId']),
 define('request_task_stop','停止指定原任务并清空其排队消息；requested 不代表底座确认停止。',{...task,requestId:string()},['projectId','taskId','turnId','requestId']),
]
export function validateManagementCall(name,args){
 const spec=managementTools.find(t=>t.name===name)
 if(!spec||!args||typeof args!=='object'||Array.isArray(args))throw Error('MANAGEMENT_INVALID_ARGUMENTS')
 const {properties,required}=spec.inputSchema
 if(Object.keys(args).some(k=>!Object.hasOwn(properties,k))||required.some(k=>!Object.hasOwn(args,k)))throw Error('MANAGEMENT_INVALID_ARGUMENTS')
 for(const [key,value]of Object.entries(args)){const p=properties[key];if(typeof value!=='string'||!value.trim()||value.length>p.maxLength)throw Error('MANAGEMENT_INVALID_ARGUMENTS')}
 return spec
}
