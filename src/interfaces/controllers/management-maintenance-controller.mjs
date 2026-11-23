import {join} from 'node:path'
import {readAgentSwitch} from '../../setup/agent-switch.mjs'
import {readChatUpgrade} from '../../setup/chat-upgrade.mjs'
import {readDiagnostics} from '../../application/diagnostics/diagnostic-commands.mjs'
import {USER_GUIDE,USER_GUIDE_EN} from '../../setup/user-guide.mjs'

const receipt=value=>value?{id:value.id,status:value.status,...value.tag?{version:value.tag}:{},...value.stage?{stage:value.stage}:{},.../^[A-Z_]+$/.test(value.error??'')?{error:value.error}:{}}:null
/** Account-bound adapter to the existing maintenance workers. No shell/MCP RPC relay. */
export function createManagementMaintenanceController({account,home,runtime,setupController,agentSwitcher,upgrader}){
 return {
  serviceStatus:()=>{const state=runtime.status();return {ready:state.ready,startup:state.startup,draining:state.draining,sealed:state.sealed,idle:state.idle,counts:state.counts}},
  installationStatus:()=>setupController.status(),
  diagnostics:()=>readDiagnostics(join(account.stateDir,'logs')),
  guide:language=>({text:language==='en'?USER_GUIDE_EN:USER_GUIDE}),
  status:async()=>({restart:receipt(await readAgentSwitch(account)),upgrade:receipt(await readChatUpgrade(home))}),
  restart:()=>agentSwitcher.handle({action:'restart'},async()=>{}),
  upgrade:async expectedRelease=>{try{return await upgrader.handle(async()=>{},{expectedRelease})}catch(error){if(error.message==='CHAT_UPGRADE_RELEASE_CHANGED')return {status:'not_executed',reason:'RELEASE_CHANGED'};throw error}},
 }
}
