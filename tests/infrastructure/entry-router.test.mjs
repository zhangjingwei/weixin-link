import test from 'node:test'
import assert from 'node:assert/strict'
import {access} from 'node:fs/promises'
import {createEntryClassifier} from '../../src/infrastructure/agents/entry-router.mjs'

test('classification has an ephemeral home, no project tools, strict output and always cleans up',async()=>{
 let options,closed=false;const calls=[]
 const classify=createEntryClassifier({binary:'/fake/codex',codexHome:'/missing/account',providerOptions:()=>({args:['app-server'],provider:null}),rpcFactory:o=>{options=o;return {write(){},close(){closed=true},async request(method,args){calls.push([method,args]);if(method==='thread/start')return {thread:{id:'router'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'};if(method==='turn/start'){queueMicrotask(()=>{o.onEvent({method:'item/completed',params:{threadId:'router',item:{type:'agentMessage',text:'{"action":"status","projectId":"1","question":null}'}}});o.onEvent({method:'turn/completed',params:{threadId:'router',turn:{id:'turn',status:'completed'}}})});return {turn:{id:'turn'}}}return {}}}}})
 assert.equal((await classify({text:'status',projects:[]})).action,'status')
 assert.equal(calls.find(([m])=>m==='thread/start')[1].ephemeral,true)
 assert.equal(calls.find(([m])=>m==='thread/start')[1].config.features.shell_tool,false)
 assert(options.providerOptions.args.includes('features.plugins=false'));assert.notEqual(options.codexHome,'/missing/account');assert(closed)
 await assert.rejects(access(options.codexHome))
})
test('server tool requests and stalled model turns fail closed and close the process',async()=>{
 let closed=false
 const make=(timeoutMs,tools)=>createEntryClassifier({binary:'/fake',codexHome:'/missing',timeoutMs,providerOptions:()=>({args:[]}),rpcFactory:o=>({write(){},respondError(){},close(){closed=true},async request(method){if(method==='thread/start')return {thread:{id:'r'},sandbox:{type:'readOnly'},approvalPolicy:'untrusted'};if(method==='turn/start'){if(tools)queueMicrotask(()=>o.onEvent({id:1,method:'item/tool/call',params:{}}));return {turn:{id:'t'}}}return {}}})})
 await assert.rejects(make(100,true)({}),/TOOL_DENIED/);assert(closed);closed=false
 await assert.rejects(make(15,false)({}),/TIMEOUT/);assert(closed)
})
