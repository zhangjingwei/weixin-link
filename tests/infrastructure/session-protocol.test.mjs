import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'

test('Codex session protocol rejects unconfirmed permissions before enabling memory',async()=>{
 const calls=[]
 const rpc={async request(method){calls.push(method);return {thread:{id:'saved'},sandbox:{type:'readOnly'},approvalPolicy:'never'}}}
 const protocol=createSessionProtocol({kind:'codex',providerEnv:{}})
 await assert.rejects(protocol.resume(rpc,{threadId:'saved',cwd:'/workspace',instructions:'rules',provider:protocol.providerOptions()}),/权限/)
 assert.deepEqual(calls,['thread/resume'])
})

test('recovery lookup stays behind the Codex protocol',async()=>{
 const calls=[],protocol=createSessionProtocol({kind:'codex'}),turn={id:'saved-turn',status:'completed',items:[]}
 const rpc={async request(method,params){calls.push([method,params.cursor]);return params.cursor?{data:[turn]}:{data:[],nextCursor:'next'}}}
 assert.equal(await protocol.recoverTurn(rpc,{threadId:'thread',turnId:'saved-turn',deliveryId:'delivery'}),turn)
 assert.deepEqual(calls,[['thread/turns/list',undefined],['thread/turns/list','next']])
})
