// Exercise the real provider adapter in an isolated CLI home and workspace.
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {discoverAgentBinaries} from '../infrastructure/agents/agent-discovery.mjs'
import {readAgentSelection} from '../infrastructure/agents/agent-selection.mjs'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {createClaudeProtocol} from '../infrastructure/agents/claude/protocol.mjs'
import {createWorkbuddyProtocol} from '../infrastructure/agents/workbuddy/protocol.mjs'
import {createDoubaoProtocol} from '../infrastructure/agents/doubao/protocol.mjs'
import {createGrokProtocol} from '../infrastructure/agents/grok/protocol.mjs'

const factories={claude:createClaudeProtocol,workbuddy:createWorkbuddyProtocol,doubao:createDoubaoProtocol,grok:createGrokProtocol}
export async function evaluationProtocol(agent,home){
 if(!Object.hasOwn(factories,agent))throw Error('Unknown agent: '+agent)
 const env={HOME:home,USERPROFILE:home}
 for(const key of ['PATH','Path','SystemRoot','TMPDIR','TEMP','TMP','LANG','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']){
  if(process.env[key])env[key]=process.env[key]
 }
 const selection=await readAgentSelection(accountPaths().stateDir)
 // Discovery finds the binary. The adapter's initialize then checks compatibility
 // and authentication using the test home, and preserves the specific failure.
 const binaries=await discoverAgentBinaries(selection,{env,inspectors:{[agent]:()=>{}}})
 const binary=binaries[agent+'Binary']
 if(!binary)throw Error(agent.toUpperCase()+'_CLI_UNAVAILABLE')
 const query=agent==='claude'?(await import('@anthropic-ai/claude-agent-sdk')).query:undefined
 return factories[agent]({binary,env,query})
}

export async function nativeScenario(protocol,scenario,{model,skillRoot}={}){
 const cwd=await mkdtemp(join(tmpdir(),'weixin-native-eval-'))
 let wait,rpc
 try{
  rpc=protocol.createRpc({cwd,onClose:()=>wait?.reject(Error('Native connection closed')),onEvent:event=>{
   if(event.id!=null){rpc.respond(event.id,{decision:'decline'});return}
   const p=event.params
   if(!wait||p?.threadId!==wait.threadId)return
   if(event.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.phase==='final_answer')wait.parts.push({turnId:p.turnId,text:p.item.text})
   if(event.method==='turn/completed')wait.resolve(p.turn)
  }})
  await protocol.initialize(rpc)
  const instructions='这是技能评测。仅回复文字，不执行外部任务。'
  const {thread}=await protocol.open(rpc,{saved:{},cwd,instructions})
  if((await protocol.read(rpc,thread.id))?.id!==thread.id)throw Error('Native session identity mismatch')
  const replies=[]
  for(const [i,step] of scenario.steps.entries()){
   let text=step.prompt
   if(i===0&&scenario.skill)text+='\n\n本用例指定以下技能：\n'+await readFile(join(skillRoot,scenario.skill,'SKILL.md'),'utf8')
   const completion=Promise.withResolvers()
   const timer=setTimeout(()=>completion.reject(Error('Native turn timed out')),120000)
   wait={...completion,threadId:thread.id,parts:[]}
   try{
    const [started,ended]=await Promise.all([protocol.startTurn(rpc,{threadId:thread.id,input:protocol.input({text}),model}),completion.promise])
    if(!started.turn?.id||ended.id!==started.turn.id||ended.status!=='completed')throw Error('Native turn unconfirmed')
    replies.push(wait.parts.filter(p=>p.turnId===ended.id).map(p=>p.text).join('\n\n'))
   }finally{clearTimeout(timer);wait=null}
  }
  return replies
 }finally{rpc?.close();await rm(cwd,{recursive:true,force:true})}
}
