import test from 'node:test'
import assert from 'node:assert/strict'
import {access} from 'node:fs/promises'
import {createEntryClassifier} from '../../src/infrastructure/agents/entry-router.mjs'

test('classification has an ephemeral home, no project tools, strict output and always cleans up',async()=>{
 let options,closed=false;const calls=[]
 const classify=createEntryClassifier({binary:'/fake/codex',codexHome:'/missing/account',providerOptions:()=>({args:['app-server'],provider:null}),rpcFactory:o=>{options=o;return {write(){},close(){closed=true},async request(method,args){calls.push([method,args]);if(method==='model/list')return {data:[{model:'gpt-6.1-terra',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}]};if(method==='thread/start')return {model:'gpt-6.1-terra',thread:{id:'router'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'};if(method==='turn/start'){queueMicrotask(()=>{o.onEvent({method:'item/completed',params:{threadId:'router',item:{type:'agentMessage',text:'{"steps":[{"action":"status","projectId":"1","question":null}],"useClarification":false}'}}});o.onEvent({method:'turn/completed',params:{threadId:'router',turn:{id:'turn',status:'completed'}}})});return {turn:{id:'turn'}}}return {}}}}})
 assert.equal((await classify({text:'status',projects:[]})).action,'status')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].ephemeral,true)
 assert.equal(calls.find(([m])=>m==='thread/start')[1].model,'gpt-6.1-terra')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].serviceTier,'auto')
 const turn=calls.find(([m])=>m==='turn/start')[1];assert.equal(turn.model,'gpt-6.1-terra');assert.equal(turn.effort,'medium');assert.equal(turn.serviceTier,'auto')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].config.features.shell_tool,false)
 assert(options.providerOptions.args.includes('features.plugins=false'));assert.notEqual(options.codexHome,'/missing/account');assert(!closed)
 await classify({text:'status again',projects:[]});assert.equal(calls.filter(([m])=>m==='model/list').length,1);assert.equal(calls.filter(([m])=>m==='thread/start').length,2)
 await classify.close();assert(closed)
 await assert.rejects(access(options.codexHome))
})
test('router rejects tool requests and lets a slow classification finish',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let emit,closed=false
 const started=Promise.withResolvers()
 const classify=createEntryClassifier({binary:'/fake',codexHome:'/missing',providerOptions:()=>({args:[]}),rpcFactory:o=>{
  emit=o.onEvent
  return {write(){},respondError(){},close(){closed=true},async request(method){
   if(method==='model/list')return {data:[{model:'gpt-6.1-terra',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]}
   if(method==='thread/start')return {model:'gpt-6.1-terra',thread:{id:'r'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'}
   if(method==='turn/start'){started.resolve();return {turn:{id:'t'}}}
   return {}
  }}
 }})
 t.after(()=>classify.close())
 const slow=classify({})
 await started.promise
 t.mock.timers.tick(120000)
 emit({method:'item/completed',params:{threadId:'r',item:{type:'agentMessage',text:'{"steps":[{"action":"status","projectId":"1","question":null}],"useClarification":false}'}}})
 emit({method:'turn/completed',params:{threadId:'r',turn:{id:'t',status:'completed'}}})
 assert.equal((await slow).action,'status')
 assert.equal(closed,false)
 const denied=classify({})
 await new Promise(resolve=>setImmediate(resolve))
 emit({id:1,method:'item/tool/call',params:{}})
 await assert.rejects(denied,/TOOL_DENIED/)
 assert.equal(closed,true)
})
test('routing policy selects only available Terra with medium support',async()=>{
 const {entryModel}=await import('../../src/domain/tasks/entry-model.mjs')
 const medium=model=>({model,supportedReasoningEfforts:[{reasoningEffort:'medium'}]})
 assert.equal(entryModel([medium('gpt-6-luna'),medium('gpt-6.1-terra')]),'gpt-6.1-terra')
 assert.throws(()=>entryModel([medium('gpt-6-luna')]),/MODEL_UNAVAILABLE/)
 assert.throws(()=>entryModel([{...medium('gpt-6.1-terra'),hidden:true}]),/MODEL_UNAVAILABLE/)
 assert.throws(()=>entryModel([{model:'gpt-6.1-terra',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]),/MODEL_UNAVAILABLE/)
})
test('absence of the selected model fails before any model turn starts',async()=>{
 let starts=0
 const classify=createEntryClassifier({binary:'/fake',codexHome:'/missing',providerOptions:()=>({args:[]}),rpcFactory:()=>({write(){},close(){},async request(method){if(method==='model/list')return {data:[{model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}]};if(method==='turn/start'||method==='thread/start')starts++;return {}}})})
 await assert.rejects(classify({}),/MODEL_UNAVAILABLE/);assert.equal(starts,0)
})
