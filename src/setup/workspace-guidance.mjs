import {join} from 'node:path'
import {readPrivateFile,atomicConfigWrite,digest} from './config-files.mjs'
import {ConfigError} from './config-schema.mjs'
const START='<!-- zerolink:managed:start -->',END='<!-- zerolink:managed:end -->'
export async function updateWorkspaceGuidance({workspace,root,codexBinary}){
 const path=join(workspace,'AGENTS.md'),previous=await readPrivateFile(path)
 const agentLine=`- 项目自带 Codex 可执行路径：${JSON.stringify(codexBinary)}（是否可用以安装诊断为准）`
 const memoryLine='- 使用 Codex 原生记忆；项目定位由底座管理，不依据历史引用推断新的执行授权。'
 const block=[START,'## ZeroLink 运行信息（由程序管理）','',`- 源码目录：${JSON.stringify(root)}`,`- 工作目录：${JSON.stringify(workspace)}`,agentLine, '- 交付文件放在工作目录 outputs/，用明确文件链接交付。','- 安装和配置通过源码目录的 src/setup/setup.mjs 操作，不直接改运行 JSON。','- 配置格式：node src/setup/setup.mjs config-schema <类型>。','- 校验：node src/setup/setup.mjs config-check <类型>；写入：node src/setup/setup.mjs config-set <类型>。配置内容通过 JSON 标准输入传入，不放进命令参数。','- 恢复上一版配置：node src/setup/setup.mjs config-restore <类型>。恢复仍需校验当前连接与运行条件。','- 查看配置就绪状态：node src/setup/setup.mjs config-status。',memoryLine,'- 可选集成通过 node src/integrations/cli.mjs list 查看；enable/disable/check/call <集成ID> [账号] 管理。默认使用当前 WECHAT_ACCOUNT；启用须有用户授权。配置类型见 list 返回的 configKind。集成说明按账号在会话连接时加载，不写入共享工作区；启用后新建或重新连接会话。','- 远程操作遵守允许根目录、任务归属和用户本次授权。','- 项目定位由智能体结合原始请求、会话与文件系统核实，不维护接入层项目别名表。','- 用户通过自然语言请求配置和多账号管理，你负责调用命令；不要要求用户使用 IDE、nano 或自行编辑 JSON。','- 多账号入口：node src/setup/account-manager.mjs <list|create|login|refresh-qr|start|stop|verify> [账号名]。创建、登录和启停需遵守用户授权；需要登录时在安装电脑显示 HTTPS 登录地址，勿在聊天中传递地址。','- 不把密码、令牌、私钥或动态任务记录写入规则文档。',END].join('\n')
 let next=previous??'# ZeroLink 智能体工作目录\n'
 const starts=next.split(START).length-1,ends=next.split(END).length-1
 if(starts!==ends||starts>1||starts&&next.indexOf(END)<next.indexOf(START))throw new ConfigError('AGENTS_MANAGED_SECTION_INVALID')
 if(starts)next=next.slice(0,next.indexOf(START))+block+next.slice(next.indexOf(END)+END.length)
 else next+=(next.endsWith('\n')?'\n':'\n\n')+block+'\n'
 await atomicConfigWrite(path,next,{expected:digest(previous),backup:true})
 const override=await readPrivateFile(join(workspace,'AGENTS.override.md'))
 return {path,managedSectionUpdated:next!==previous,needsNewSession:true,overridePresent:!!override?.trim()}
}
