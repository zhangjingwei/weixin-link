import {createMultiAgentProtocol} from './multi-agent-protocol.mjs'
import {join} from 'node:path'
import {readAgentSelection} from './agent-selection.mjs'
import {createClaudeProtocol} from './claude/protocol.mjs'
import {createSessionProtocol} from './session-protocol.mjs'
import {ensureAccountCodexHome} from '../accounts/codex-home.mjs'
import {readProviderProfile,providerEnvironment} from '../accounts/provider-profile.mjs'

// Codex transport and session details stay behind this boundary.
export async function loadAgentAdapter(account,workspace,installation){
 const selected=await readAgentSelection(account.stateDir)
 const kind=selected.kind
 const backend={id:kind==='claude'?'claude':'host',kind:'host',cwd:workspace,stateDir:kind==='claude'?join(account.stateDir,'agents','claude'):account.stateDir,memoryMode:'native',instructions:'使用当前智能体的原生会话与记忆；切换时保留各底座独立的原生会话。'}
 const codexHome=await ensureAccountCodexHome(account.id)
 const profile=await readProviderProfile(account.stateDir)
 const provider=providerEnvironment(profile)
 const protocols={codex:createSessionProtocol({rpcFactory:backend.rpcFactory,providerEnv:provider.options,providerSecrets:provider.secrets,codexBinary:()=>installation.codexBinary,codexHome})}
 const claudeBinary=selected.claudeBinary??(kind==='claude'?selected.binary:null)
 if(claudeBinary){const {query}=await import('@anthropic-ai/claude-agent-sdk');protocols.claude=createClaudeProtocol({binary:claudeBinary,query})}
 return {kind,name:kind==='claude'?'Claude Code':'Codex',backend,sessionOptions:{codexHome,sessionProtocol:createMultiAgentProtocol(protocols,kind)},catalog:'official',providerKind:profile?.kind??'subscription'}
}
