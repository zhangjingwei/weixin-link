import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url))
// Per-session app-server configuration: no shared ~/.codex config and no persistent token.
export function managementConfiguration({socket,capability,controlToken,sourceRoot=root}){
 return {config:{'mcp_servers.zerolink-management':{command:process.execPath,args:[join(sourceRoot,'src/interfaces/cli/management-mcp.mjs')],env_vars:['ZEROLINK_MANAGEMENT_SOCKET','ZEROLINK_MANAGEMENT_CAPABILITY','ZEROLINK_MANAGEMENT_PIPE_TOKEN'],startup_timeout_sec:15,tool_timeout_sec:30}},environment:{ZEROLINK_MANAGEMENT_SOCKET:socket,ZEROLINK_MANAGEMENT_CAPABILITY:capability,...controlToken?{ZEROLINK_MANAGEMENT_PIPE_TOKEN:controlToken}:{}}}
}
export const managementGuidance='需要管理微信项目、查询其他项目进展、切换会话、补充或停止指定任务时，先阅读 '+join(root,'plugins/zerolink-management/skills/zerolink-manage/SKILL.md')+'，使用 zerolink-management MCP。用户查看结果时调用 get_task_result，只汇报结果和附件名称；只有明确要求重发才用 resultToken 调用 request_result_redelivery。询问状态时根据上下文调用 get_project_status 或 get_service_status；当前项目编号从 get_conversation_context 获取。查询项目必须调用 list_projects；按话题找会话调用 search_sessions，会话内搜原文调用 search_session_history；列出会话调用 list_project_sessions，查全部时省略 nativeProjectId。用户要看更多会话时沿用上一页的查询范围和 nextCursor。工具失败时说明查询失败。用户只说“切换”时结合上文判断对象和目标，缺少目标就用一句话问清，允许直接回复名称。只读查询不切换；pending/requested 不代表已完成。精确控制命令仍由原入口处理。'
