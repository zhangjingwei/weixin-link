import {loadBackend as loadCodexBackend} from './codex-backend.mjs'
import {listAccounts} from '../accounts/account-store.mjs'
import {createSessionProtocol} from './session-protocol.mjs'

// Codex transport and session details stay behind this boundary.
export async function loadAgentAdapter(account,workspace,installation){
 const kind='codex'
 const backend=await loadCodexBackend(account,workspace,undefined,{listAccounts})
 return {kind,name:'Codex',backend,sessionOptions:{sessionProtocol:createSessionProtocol({rpcFactory:backend.rpcFactory,providerEnv:backend.kind==='podman'?{}:process.env,codexBinary:()=>installation.codexBinary})},catalog:'official'}
}
