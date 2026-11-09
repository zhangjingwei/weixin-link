import {loadBackend as loadCodexBackend} from '../../base/codex/codex-backend.mjs'
import {ClaudeRpc} from '../../base/claude/claude-rpc.mjs'
import {join} from 'node:path'

// The account chooses one agent. Transport, session identity and capabilities stay
// behind this boundary; the intake and delivery engine is shared.
export async function loadAgentAdapter(account,workspace,installation){
 const kind=installation.agentBackend??'codex'
 if(kind==='codex')return {kind,name:'Codex',backend:await loadCodexBackend(account,workspace),sessionOptions:{},catalog:'official'}
 if(kind==='claude'){
  if(!installation.claudeBinary)throw Error('CLAUDE_BINARY_NOT_CONFIGURED')
  const backend={id:'claude-host',kind:'host',agentKind:'claude',cwd:workspace,stateDir:join(account.stateDir,'backends','claude'),memoryMode:'claude',instructions:'当前底座为 Claude。只使用本轮已关联的材料；交付文件保存到工作目录 outputs/ 并给出绝对路径链接。当前 CLI 会话不提供 Codex 原生记忆接口，不声称已保存长期记忆。'}
  return {kind,name:'Claude',backend,catalog:'local',sessionOptions:{agentKind:'claude',rpcFactory:options=>new ClaudeRpc({...options,binary:installation.claudeBinary,stateDir:backend.stateDir,env:{...process.env,CLAUDE_CONFIG_DIR:join(backend.stateDir,'config')}})}}
 }
 throw Error('UNKNOWN_AGENT_BACKEND')
}
