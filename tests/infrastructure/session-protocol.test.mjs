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
test('private provider credentials reach the local Codex process without entering CLI arguments',()=>{
 const key='test-only-private-key',providerEnv={WECHAT_CODEX_PROVIDER:'custom',WECHAT_CODEX_BASE_URL:'https://provider.example.com',WECHAT_CODEX_API_KEY_ENV:'PRIVATE_MODEL_KEY',WECHAT_CODEX_MODEL:'custom-model'}
 let spawned
 const protocol=createSessionProtocol({providerEnv,providerSecrets:{PRIVATE_MODEL_KEY:key},codexHome:'/private/account/codex-home',codexBinary:()=>'/bundled/codex',rpcFactory:options=>{spawned=options;return {}}})
 const options=protocol.providerOptions()
 assert.equal(options.credentialReady,true)
 assert(!options.args.join(' ').includes(key))
 protocol.createRpc({providerOptions:options})
 assert.equal(spawned.providerSecrets.PRIVATE_MODEL_KEY,key)
 assert.equal(spawned.codexHome,'/private/account/codex-home')
 assert.equal(spawned.binary,'/bundled/codex')
})
