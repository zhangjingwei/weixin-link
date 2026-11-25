import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {readAgentSelection} from '../infrastructure/agents/agent-selection.mjs'
import {discoverAgentBinaries} from '../infrastructure/agents/agent-discovery.mjs'
import {inspectSystemCodex} from '../infrastructure/agents/codex/installation.mjs'

export async function systemCodex(home,{env=process.env,run}={}){
 const selection=await readAgentSelection(accountPaths('default',home).stateDir)
 const {codexBinary}=await discoverAgentBinaries(selection,{env,inspectors:{
  codex:(path,options)=>inspectSystemCodex(path,{...options,run})
 }})
 if(!codexBinary)throw Error('CODEX_SYSTEM_CLI_UNAVAILABLE')
 return codexBinary
}
