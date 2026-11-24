import test from 'node:test'
import assert from 'node:assert/strict'
import {access} from 'node:fs/promises'
import {createEntryClassifier} from '../../src/infrastructure/agents/entry-router.mjs'

test('classification has an ephemeral home, no project tools, strict output and always cleans up',async()=>{
 let options,closed=false;const calls=[]
 const classify=createEntryClassifier({binary:'/fake/codex',codexHome:'/missing/account',providerOptions:()=>({args:['app-server'],provider:null}),rpcFactory:o=>{options=o;return {write(){},close(){closed=true},async request(method,args){calls.push([method,args]);if(method==='model/list')return {data:[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}]};if(method==='thread/start')return {model:'gpt-6-luna',thread:{id:'router'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'};if(method==='turn/start'){queueMicrotask(()=>{o.onEvent({method:'item/completed',params:{threadId:'router',item:{type:'agentMessage',text:'{"action":"status","projectId":"1","question":null}'}}});o.onEvent({method:'turn/completed',params:{threadId:'router',turn:{id:'turn',status:'completed'}}})});return {turn:{id:'turn'}}}return {}}}}})
 assert.equal((await classify({text:'status',projects:[]})).action,'status')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].ephemeral,true)
 assert.equal(calls.find(([m])=>m==='thread/start')[1].model,'gpt-6-luna')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].serviceTier,'fast')
 const turn=calls.find(([m])=>m==='turn/start')[1];assert.equal(turn.model,'gpt-6-luna');assert.equal(turn.effort,'medium');assert.equal(turn.serviceTier,'fast')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].config.features.shell_tool,false)
 assert(options.providerOptions.args.includes('features.plugins=false'));assert.notEqual(options.codexHome,'/missing/account');assert(!closed)
 await classify({text:'status again',projects:[]});assert.equal(calls.filter(([m])=>m==='model/list').length,1);assert.equal(calls.filter(([m])=>m==='thread/start').length,2)
 await classify.close();assert(closed)
 await assert.rejects(access(options.codexHome))
})
test('server tool requests and stalled model turns fail closed and close the process',async()=>{
 let closed=false
 const make=(timeoutMs,tools)=>createEntryClassifier({binary:'/fake',codexHome:'/missing',timeoutMs,providerOptions:()=>({args:[]}),rpcFactory:o=>({write(){},respondError(){},close(){closed=true},async request(method){if(method==='model/list')return {data:[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}]};if(method==='thread/start')return {model:'gpt-6-luna',thread:{id:'r'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'};if(method==='turn/start'){if(tools)queueMicrotask(()=>o.onEvent({id:1,method:'item/tool/call',params:{}}));return {turn:{id:'t'}}}return {}}})})
 await assert.rejects(make(100,true)({}),/TOOL_DENIED/);assert(closed);closed=false
 await assert.rejects(make(15,false)({}),/TIMEOUT/);assert(closed)
})
test('budget policy selects only listed low-cost models and never upgrades to a premium default',async()=>{
 const {entryModel}=await import('../../src/domain/tasks/entry-model.mjs')
 const low=model=>({model,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]})
 assert.equal(entryModel([low('gpt-5.6-luna'),low('gpt-6-luna')]),'gpt-6-luna')
 assert.equal(entryModel([low('gpt-5.6-luna')]),'gpt-5.6-luna')
 assert.throws(()=>entryModel([low('gpt-6.1-sol')]),/BUDGET_MODEL_UNAVAILABLE/)
 assert.throws(()=>entryModel([{...low('gpt-6-luna'),hidden:true}]),/BUDGET_MODEL_UNAVAILABLE/)
})
test('absence of a budget candidate fails before any model turn starts',async()=>{
 let starts=0
 const classify=createEntryClassifier({binary:'/fake',codexHome:'/missing',providerOptions:()=>({args:[]}),rpcFactory:()=>({write(){},close(){},async request(method){if(method==='model/list')return {data:[{model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}]};if(method==='turn/start'||method==='thread/start')starts++;return {}}})})
 await assert.rejects(classify({}),/BUDGET_MODEL_UNAVAILABLE/);assert.equal(starts,0)
})
