import {entryModel} from '../../domain/tasks/entry-model.mjs'
import {createSessionProtocol} from './session-protocol.mjs'
import {mkdtemp,mkdir,copyFile,chmod,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CodexRpc} from '../../base/codex/codex-rpc.mjs'
import {initializeCodex} from '../../base/codex/protocol-operations.mjs'

export {routeSchema} from './entry-classification.mjs'
import {routeSchema,entryInstructions,classificationInput,classificationDecision} from './entry-classification.mjs'

// Separate ephemeral process/home: no project files, plugins, MCP credentials or
// native session history are inherited. Only account authentication is copied.
export function createEntryClassifier({binary,codexHome,providerOptions,providerSecrets={},rpcFactory=options=>new CodexRpc(options),idleMs=60000,modelCacheMs=300000,maxRequests=32,selectModel=entryModel,reasoningEffort='medium',serviceTier='auto'}){
 const stats={calls:0,failures:0,inputTokens:0,outputTokens:0,usageSamples:0,modelListQueries:0,processStarts:0}
 let worker,closed=false,tail=Promise.resolve(),idleTimer
 const classify=input=>{
  const run=tail.catch(()=>{}).then(()=>{if(closed)throw Error('ENTRY_ROUTER_CLOSED');return classifyOne(input)})
  tail=run;return run
 }
 classify.statistics=()=>({...stats})
 classify.close=async()=>{closed=true;clearTimeout(idleTimer);worker?.reject?.(Error('ENTRY_ROUTER_CLOSED'));await dispose();await tail.catch(()=>{})}
 async function dispose(){
  const w=worker;worker=null;if(!w)return;w.disposed=true;clearTimeout(idleTimer)
  const child=w.rpc?.child
  if(child&&child.exitCode===null&&child.signalCode===null){let timer;const ended=new Promise(resolve=>child.once('close',resolve));w.rpc.close();await Promise.race([ended,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},1000)})]);clearTimeout(timer)}else w.rpc?.close()
  await rm(w.dir,{recursive:true,force:true})
 }
 async function open(){
  const selected=providerOptions();if(selected.provider)throw Error('ENTRY_ROUTER_PROVIDER_UNSUPPORTED')
  const dir=await mkdtemp(join(tmpdir(),'zerolink-entry-'));await chmod(dir,0o700)
  stats.processStarts++
  const w={dir,count:0,modelAt:0};worker=w
  const home=join(dir,'home');await mkdir(home,{mode:0o700})
  try{await copyFile(join(codexHome,'auth.json'),join(home,'auth.json'));await chmod(join(home,'auth.json'),0o600)}catch(error){if(error.code!=='ENOENT')throw error}
  if(closed||w.disposed)throw Error('ENTRY_ROUTER_CLOSED')
  const config={web_search:'disabled',features:{shell_tool:false,plugins:false,apps:false,multi_agent:false,multi_agent_v2:false,browser_use:false,browser_use_external:false,browser_use_full_cdp_access:false,computer_use:false,code_mode:false,remote_plugin:false,goals:false},memories:{generate_memories:false,use_memories:false}}
  const args=[...selected.args]
  for(const [key,value]of Object.entries(config)){
   if(value&&typeof value==='object')for(const [field,item]of Object.entries(value))args.push('-c',`${key}.${field}=${JSON.stringify(item)}`)
   else args.push('-c',`${key}=${JSON.stringify(value)}`)
  }
  w.config=config
  w.rpc=rpcFactory({binary,codexHome:home,cwd:dir,providerOptions:{...selected,args},providerSecrets,onClose:()=>{w.reject?.(Error('ENTRY_ROUTER_DISCONNECTED'));w.dead=true},onEvent:message=>{
   if(message.id!==undefined&&message.method){w.rpc.respondError(message.id,{code:-32601,message:'ENTRY_ROUTER_TOOLS_DISABLED'});w.reject?.(Error('ENTRY_ROUTER_TOOL_DENIED'));return}
   const p=message.params??{};if(!w.threadId||p.threadId!==w.threadId)return
   if(message.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.phase!=='commentary'){w.text+=p.item.text??'';if(w.text.length>16000)w.reject?.(Error('ENTRY_ROUTER_OUTPUT_LIMIT'))}
   if(message.method==='thread/tokenUsage/updated'&&p.tokenUsage?.last)w.usage=p.tokenUsage.last
   if(message.method==='turn/completed'&&(!w.turnId||p.turn?.id===w.turnId))p.turn?.status==='completed'?w.resolve?.(w.text):w.reject?.(Error('ENTRY_ROUTER_TURN_FAILED'))
  }})
  await initializeCodex(w.rpc,{name:'zerolink_entry',version:'1.1.0'});return w
 }
 async function classifyOne(input){
  if(Buffer.byteLength(JSON.stringify(input))>256*1024)throw Error('ENTRY_ROUTER_INPUT_LIMIT')
  const payload=JSON.stringify(classificationInput(input))
  clearTimeout(idleTimer);stats.calls++;const startedAt=Date.now();let w
  try{
   if(worker&&(worker.dead||worker.count>=maxRequests))await dispose()
   w=worker??await open();w.text='';w.threadId=null;w.turnId=null;w.usage=null
   const final=new Promise((resolve,reject)=>{w.resolve=resolve;w.reject=reject});void final.catch(()=>{})
   if(!w.model||Date.now()-w.modelAt>modelCacheMs){stats.modelListQueries++;const {models}=await createSessionProtocol().listModels(w.rpc);w.model=selectModel(models.filter(model=>model.supportedReasoningEfforts?.some(e=>e.reasoningEffort===reasoningEffort)));stats.model=w.model;stats.reasoningEffort=reasoningEffort;stats.serviceTier=serviceTier;if(!models.some(model=>model.model===w.model&&model.supportedReasoningEfforts?.some(e=>e.reasoningEffort===reasoningEffort)))throw Error('ENTRY_ROUTER_MODEL_CONFIGURATION_UNAVAILABLE');w.modelAt=Date.now()}
   const result=await w.rpc.request('thread/start',{cwd:w.dir,model:w.model,serviceTier,ephemeral:true,sandbox:'read-only',approvalPolicy:'untrusted',baseInstructions:entryInstructions,developerInstructions:'只分类；没有工具权限。',config:w.config})
   if(result.model!==w.model)throw Error('ENTRY_ROUTER_MODEL_UNCONFIRMED')
   w.threadId=result.thread?.id;if(!w.threadId||result.sandbox?.type!=='readOnly'||result.approvalPolicy!=='untrusted')throw Error('ENTRY_ROUTER_POLICY_UNCONFIRMED')
   const started=await w.rpc.request('turn/start',{threadId:w.threadId,model:w.model,effort:reasoningEffort,serviceTier,input:[{type:'text',text:payload}],outputSchema:routeSchema})
   w.turnId=started.turn?.id;if(!w.turnId)throw Error('ENTRY_ROUTER_TURN_UNCONFIRMED')
   const decision=classificationDecision(JSON.parse(await final));w.count++;if(w.usage){stats.inputTokens+=w.usage.inputTokens??0;stats.outputTokens+=w.usage.outputTokens??0;stats.usageSamples++}return decision
  }catch(error){stats.failures++;w?.reject?.(error);await dispose();throw error}
  finally{stats.lastLatencyMs=Date.now()-startedAt;if(w){w.resolve=null;w.reject=null}if(worker&&!closed){idleTimer=setTimeout(()=>{void dispose()},idleMs);idleTimer.unref?.()}}
 }
 return classify
}
