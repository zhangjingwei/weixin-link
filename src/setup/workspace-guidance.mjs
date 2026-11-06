import {join} from 'node:path'
import {readPrivateFile,atomicConfigWrite,digest} from './config-files.mjs'
import {ConfigError} from './config-schema.mjs'
const START='<!-- zerolink:managed:start -->',END='<!-- zerolink:managed:end -->'
export async function updateWorkspaceGuidance({workspace,root,codexBinary}){
 const path=join(workspace,'AGENTS.md'),previous=await readPrivateFile(path)
 const block=[START,'## ZeroLink 运行信息（由程序管理）','',`- 源码目录：${JSON.stringify(root)}`,`- 工作目录：${JSON.stringify(workspace)}`,`- Codex 可执行路径：${JSON.stringify(codexBinary)}（是否可用以安装诊断为准）`, '- 交付文件放在工作目录 outputs/，用明确文件链接交付。','- 安装和配置通过源码目录的 src/setup/setup.mjs 操作，不直接改运行 JSON。','- 配置格式：node src/setup/setup.mjs config-schema <installation|ha|backup|remote-hosts>。','- 校验：node src/setup/setup.mjs config-check <类型>；写入：node src/setup/setup.mjs config-set <类型>。配置内容通过 JSON 标准输入传入，不放进命令参数。','- 查看配置就绪状态：node src/setup/setup.mjs config-status。','- 使用 Codex 原生记忆；项目定位由底座管理，不依据历史引用推断新的执行授权。','- HA 只读；远程操作遵守允许根目录、任务归属和用户本次授权。','- 项目定位由智能体结合原始请求、会话与文件系统核实，不维护接入层项目别名表。','- 不把密码、令牌、私钥或动态任务记录写入规则文档。',END].join('\n')
 let next=previous??'# ZeroLink 智能体工作目录\n'
 const starts=next.split(START).length-1,ends=next.split(END).length-1
 if(starts!==ends||starts>1||starts&&next.indexOf(END)<next.indexOf(START))throw new ConfigError('AGENTS_MANAGED_SECTION_INVALID')
 if(starts)next=next.slice(0,next.indexOf(START))+block+next.slice(next.indexOf(END)+END.length)
 else next+=(next.endsWith('\n')?'\n':'\n\n')+block+'\n'
 await atomicConfigWrite(path,next,{expected:digest(previous),backup:true})
 const override=await readPrivateFile(join(workspace,'AGENTS.override.md'))
 return {path,managedSectionUpdated:next!==previous,needsNewSession:true,overridePresent:!!override?.trim()}
}
