import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url))
// Per-session app-server configuration: no shared ~/.codex config and no persistent token.
export function managementConfiguration({socket,capability,controlToken,sourceRoot=root}){
 return {config:{'mcp_servers.zerolink-management':{command:process.execPath,args:[join(sourceRoot,'src/interfaces/cli/management-mcp.mjs')],env_vars:['ZEROLINK_MANAGEMENT_SOCKET','ZEROLINK_MANAGEMENT_CAPABILITY','ZEROLINK_MANAGEMENT_PIPE_TOKEN'],startup_timeout_sec:15,tool_timeout_sec:30}},environment:{ZEROLINK_MANAGEMENT_SOCKET:socket,ZEROLINK_MANAGEMENT_CAPABILITY:capability,...controlToken?{ZEROLINK_MANAGEMENT_PIPE_TOKEN:controlToken}:{}}}
}
export const managementGuidance='微信项目管理、会话导航及跨会话转交按 managing-zerolink 技能执行；仅在用户明确要求时切换或转交。'
