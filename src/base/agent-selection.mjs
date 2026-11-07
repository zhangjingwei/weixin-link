import {join} from 'node:path'
import {readPrivateFile,atomicConfigWrite} from '../setup/config-files.mjs'

export const agentSelectionPath=account=>join(account.stateDir,'agent-selection.json')
export const agentKinds=['codex','claude']

export async function selectedAgentKind(account,installation){
 const text=await readPrivateFile(agentSelectionPath(account))
 if(text===null)return installation.agentBackend??'codex'
 let value
 try{value=JSON.parse(text)}catch{throw Error('AGENT_SELECTION_INVALID')}
 if(value?.version!==1||!agentKinds.includes(value.agentBackend)||Object.keys(value).some(key=>!['version','agentBackend'].includes(key)))throw Error('AGENT_SELECTION_INVALID')
 return value.agentBackend
}

export async function writeAgentKind(account,kind){
 if(!agentKinds.includes(kind))throw Error('UNKNOWN_AGENT_BACKEND')
 return atomicConfigWrite(agentSelectionPath(account),JSON.stringify({version:1,agentBackend:kind},null,2)+'\n',{backup:true})
}
