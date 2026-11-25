import {createSessionProtocol} from './session-protocol.mjs'
import {ensureAccountCodexHome} from '../accounts/codex-home.mjs'
import {readProviderProfile,providerEnvironment} from '../accounts/provider-profile.mjs'

// Codex transport and session details stay behind this boundary.
export async function loadAgentAdapter(account,workspace,installation){
 const kind='codex'
 const backend={id:'host',kind:'host',cwd:workspace,stateDir:account.stateDir,memoryMode:'native',instructions:'长期记忆统一使用当前 Codex 原生记忆，不生成微信自定义记忆块。'}
 const codexHome=await ensureAccountCodexHome(account.id)
 const profile=await readProviderProfile(account.stateDir)
 const provider=providerEnvironment(profile)
 return {kind,name:'Codex',backend,sessionOptions:{codexHome,sessionProtocol:createSessionProtocol({rpcFactory:backend.rpcFactory,providerEnv:provider.options,providerSecrets:provider.secrets,codexBinary:()=>installation.codexBinary,codexHome})},catalog:'official',providerKind:profile?.kind??'subscription'}
}
