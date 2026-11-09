import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'

test('Claude session protocol resumes without Codex permissions or memory calls',async()=>{
 const calls=[]
 const rpc={async request(method,params){calls.push({method,params});return {thread:{id:'saved'}}}}
 const protocol=createSessionProtocol({kind:'claude'})
 const result=await protocol.resume(rpc,{threadId:'saved',cwd:'/workspace',instructions:'rules',provider:protocol.providerOptions()})
 assert.equal(result.thread.id,'saved')
 assert.deepEqual(calls.map(call=>call.method),['thread/resume'])
 assert.equal(calls[0].params.developerInstructions,'rules')
 assert.equal(calls[0].params.sandbox,undefined)
 assert.equal(calls[0].params.config,undefined)
 assert.equal(protocol.supportsMemory,false)
 assert.equal(protocol.supportsModels,false)
})

test('Codex session protocol rejects unconfirmed permissions before enabling memory',async()=>{
 const calls=[]
 const rpc={async request(method){calls.push(method);return {thread:{id:'saved'},sandbox:{type:'readOnly'},approvalPolicy:'never'}}}
 const protocol=createSessionProtocol({kind:'codex',providerEnv:{}})
 await assert.rejects(protocol.resume(rpc,{threadId:'saved',cwd:'/workspace',instructions:'rules',provider:protocol.providerOptions()}),/权限/)
 assert.deepEqual(calls,['thread/resume'])
})

test('recovery lookup stays behind the selected agent protocol',async()=>{
 const calls=[],protocol=createSessionProtocol({kind:'codex'}),turn={id:'saved-turn',status:'completed',items:[]}
 const rpc={async request(method,params){calls.push([method,params.cursor]);return params.cursor?{data:[turn]}:{data:[],nextCursor:'next'}}}
 assert.equal(await protocol.recoverTurn(rpc,{threadId:'thread',turnId:'saved-turn',deliveryId:'delivery'}),turn)
 assert.deepEqual(calls,[['thread/turns/list',undefined],['thread/turns/list','next']])
 const claude=createSessionProtocol({kind:'claude'})
 assert.equal(claude.supportsRemoteTaskRecovery,false)
 await assert.rejects(claude.recoverTurn(rpc,{threadId:'thread',turnId:'saved-turn'}),/AGENT_RECOVERY_UNAVAILABLE/)
 assert.equal(calls.length,2)
})
