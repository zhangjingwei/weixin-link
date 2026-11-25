import {createMultiAgentProtocol} from './multi-agent-protocol.mjs'
import {join} from 'node:path'
import {discoverAgentBinaries} from './agent-discovery.mjs'
import {readAgentSelection,saveAgentSelection} from './agent-selection.mjs'
import {createDoubaoProtocol} from './doubao/protocol.mjs'
import {createGrokProtocol} from './grok/protocol.mjs'
import {createWorkbuddyProtocol} from './workbuddy/protocol.mjs'
import {createClaudeProtocol} from './claude/protocol.mjs'
import {createSessionProtocol} from './session-protocol.mjs'
import {ensureAccountCodexHome} from '../accounts/codex-home.mjs'
// Codex transport and session details stay behind this boundary.
export async function loadAgentAdapter(account,workspace,installation,{discover=discoverAgentBinaries}={}){
 const selected=await readAgentSelection(account.stateDir)
 const binaries=await discover(selected)
 const kind=selected.kind
 const backend={id:kind==='claude'?'claude':'host',kind:'host',cwd:workspace,stateDir:kind==='claude'?join(account.stateDir,'agents','claude'):account.stateDir,memoryMode:'native',instructions:'使用当前智能体的原生会话与记忆；切换时保留各底座独立的原生会话。'}
 const protocols={}
 const codexBinary=binaries.codexBinary
 let codexHome
 const factories={
  codex:async binary=>{
   codexHome=await ensureAccountCodexHome(account.id)
   return createSessionProtocol({nativeProfile:true,codexBinary:()=>binary,codexHome})
  },
  workbuddy:binary=>createWorkbuddyProtocol({binary}),
  doubao:binary=>createDoubaoProtocol({binary}),
  grok:binary=>createGrokProtocol({binary}),
  claude:async binary=>{
   const {query}=await import('@anthropic-ai/claude-agent-sdk')
   return createClaudeProtocol({binary,query})
  },
 }
 for(const [agentKind,create] of Object.entries(factories)){
  const binary=binaries[agentKind+'Binary']
  if(binary)protocols[agentKind]=await create(binary)
 }
 let pendingRegistration=Promise.resolve()
 const registry={
  async list(){
   const detected=await discover(await readAgentSelection(account.stateDir),{verifyExplicit:true})
   return Object.keys(factories).map(agentKind=>({agentKind,registered:Object.hasOwn(protocols,agentKind),detected:!!detected[agentKind+'Binary']}))
  },
  register(agentKind){
   const work=pendingRegistration.then(async()=>{
    if(!Object.hasOwn(factories,agentKind))throw Error('MANAGEMENT_AGENT_UNSUPPORTED')
    const config=await readAgentSelection(account.stateDir),field=agentKind+'Binary'
    const found=await discover(config,{kinds:[agentKind],verifyExplicit:true})
    const binary=found[field]
    if(!binary)throw Error('MANAGEMENT_AGENT_NOT_DETECTED')
    if(protocols[agentKind]&&binaries[field]!==binary)throw Error('MANAGEMENT_AGENT_BINARY_CHANGED')
    const protocol=protocols[agentKind]??await factories[agentKind](binary)
    if(config[field]!==binary)await saveAgentSelection(account.stateDir,{...config,[field]:binary})
    binaries[field]=binary
    protocols[agentKind]=protocol
    return {agentKind,registered:true}
   })
   pendingRegistration=work.catch(()=>{})
   return work
  },
 }
 const sessionProtocol=createMultiAgentProtocol(protocols)
 return {kind,codexBinary,registry,name:({workbuddy:'WorkBuddy',claude:'Claude Code',doubao:'Doubao',grok:'Grok'})[kind]??'Codex',backend,sessionOptions:{codexHome,sessionProtocol},catalog:'official',providerKind:['workbuddy','doubao','grok'].includes(kind)?kind+'-account':kind==='claude'?'claude-subscription':'subscription'}
}
