import {join} from 'node:path'
import {readAgentSelection} from './agent-selection.mjs'
import {createClaudeProtocol} from './claude/protocol.mjs'
import {createSessionProtocol} from './session-protocol.mjs'
import {ensureAccountCodexHome} from '../accounts/codex-home.mjs'
import {readProviderProfile,providerEnvironment} from '../accounts/provider-profile.mjs'

// Codex transport and session details stay behind this boundary.
export async function loadAgentAdapter(account,workspace,installation){
 const selected=await readAgentSelection(account.stateDir)
 if(selected.kind==='claude'){
  const {query}=await import('@anthropic-ai/claude-agent-sdk')
  return {kind:'claude',name:'Claude Code',backend:{id:'claude',kind:'host',cwd:workspace,stateDir:join(account.stateDir,'agents','claude'),memoryMode:'native',instructions:'使用 Claude Code 原生会话和记忆；当前底座不支持 Codex 原生项目、原生队列、goal 或 Codex 桌面接续。'},
   sessionOptions:{sessionProtocol:createClaudeProtocol({binary:selected.binary,query})},catalog:'local',providerKind:'claude-subscription'}
 }
 const kind='codex'
 const backend={id:'host',kind:'host',cwd:workspace,stateDir:account.stateDir,memoryMode:'native',instructions:'长期记忆统一使用当前 Codex 原生记忆，不生成微信自定义记忆块。'}
 const codexHome=await ensureAccountCodexHome(account.id)
 const profile=await readProviderProfile(account.stateDir)
 const provider=providerEnvironment(profile)
 return {kind,name:'Codex',backend,sessionOptions:{codexHome,sessionProtocol:createSessionProtocol({rpcFactory:backend.rpcFactory,providerEnv:provider.options,providerSecrets:provider.secrets,codexBinary:()=>installation.codexBinary,codexHome})},catalog:'official',providerKind:profile?.kind??'subscription'}
}
