import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url))
// Per-session app-server configuration: no shared ~/.codex config and no persistent token.
export function managementConfiguration({socket,capability,controlToken,sourceRoot=root}){
 return {config:{'mcp_servers.zerolink-management':{command:process.execPath,args:[join(sourceRoot,'src/interfaces/cli/management-mcp.mjs')],env_vars:['ZEROLINK_MANAGEMENT_SOCKET','ZEROLINK_MANAGEMENT_CAPABILITY','ZEROLINK_MANAGEMENT_PIPE_TOKEN'],startup_timeout_sec:15,tool_timeout_sec:30}},environment:{ZEROLINK_MANAGEMENT_SOCKET:socket,ZEROLINK_MANAGEMENT_CAPABILITY:capability,...controlToken?{ZEROLINK_MANAGEMENT_PIPE_TOKEN:controlToken}:{}}}
}
export const managementGuidance='需要管理微信项目、查询其他项目进展、切换会话、补充或停止指定任务时，先阅读 '+join(root,'plugins/zerolink-management/skills/zerolink-manage/SKILL.md')+'，使用 zerolink-management MCP。只读查询不切换；pending/requested 不代表已完成。精确控制命令仍由原入口处理。'
