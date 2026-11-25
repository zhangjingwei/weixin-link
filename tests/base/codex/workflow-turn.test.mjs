import test from 'node:test'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {createSessionProtocol} from '../../../src/infrastructure/agents/session-protocol.mjs'
import {ASSISTANT_INSTRUCTIONS} from '../../../src/infrastructure/agents/assistant-policy.mjs'

test('session initialization registers the bundled skill root before opening threads',async()=>{
 const calls=[]
 const rpc={request:async(method,params)=>calls.push({method,params}),write:message=>calls.push(message)}
 await createSessionProtocol().initialize(rpc)
 assert.deepEqual(calls.map(call=>call.method),['initialize','initialized','skills/extraRoots/set'])
 assert.deepEqual(calls[2].params.extraRoots,[fileURLToPath(new URL('../../../src/infrastructure/agents/skills',import.meta.url))])
 assert.doesNotMatch(ASSISTANT_INSTRUCTIONS,/description:|❓ Zero · 想问你|📦 Zero · 交付|route_conversation_request/)
})

test('a rejected skill root registration fails session initialization',async()=>{
 const error=Error('registration rejected')
 const rpc={write(){},async request(method){if(method==='skills/extraRoots/set')throw error}}
 await assert.rejects(createSessionProtocol().initialize(rpc),error)
})

test('plan-only input preserves its authorization boundary without forcing a skill',async()=>{
 const input=[{type:'text',text:'一起设计搜索机制'},{type:'text',text:'用户选择了微信的“计划”：本轮仅调研和制定方案，等用户明确要求实施后再改动项目。'}]
 const rpc={request:async(method,params)=>params}
 const turn=await createSessionProtocol().startTurn(rpc,{threadId:'t',input})
 assert.deepEqual(turn.input,input)
 assert.equal(input.length,2)
})

test('ordinary requests and short follow-ups reach the same thread without extra instructions',async()=>{
 const protocol=createSessionProtocol()
 const rpc={request:async(method,params)=>{assert.equal(method,'turn/start');return params}}
 for(const text of ['我给10个人做值班表，用表格还是网页','想一起讨论搜索机制','对','继续','结果']){
  const input=[{type:'text',text}]
  const turn=await protocol.startTurn(rpc,{threadId:'same-thread',input,model:'test-model'})
  assert.equal(turn.threadId,'same-thread')
  assert.deepEqual(turn.input,input)
  assert.equal(turn.collaborationMode.mode,'default')
  assert.equal(turn.collaborationMode.settings.developer_instructions,null)
 }
})
