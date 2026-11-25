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

test('an explicit plan command attaches the native design skill to the original input',async()=>{
 const input=[{type:'text',text:'一起设计搜索机制'}]
 const rpc={request:async(method,params)=>params}
 const turn=await createSessionProtocol().startTurn(rpc,{threadId:'t',input,workflowMode:'plan'})
 const path=fileURLToPath(new URL('../../../src/infrastructure/agents/skills/discussing-designs/SKILL.md',import.meta.url))
 assert.deepEqual(turn.input,[input[0],{type:'skill',name:'discussing-designs',path}])
 assert.equal(input.length,1)
})

test('ordinary requests and short follow-ups reach the same thread without extra instructions',async()=>{
 const protocol=createSessionProtocol()
 const rpc={request:async(method,params)=>{assert.equal(method,'turn/start');return params}}
 for(const text of ['想一起讨论搜索机制','对','继续','结果']){
  const input=[{type:'text',text}]
  const turn=await protocol.startTurn(rpc,{threadId:'same-thread',input,model:'test-model'})
  assert.equal(turn.threadId,'same-thread')
  assert.deepEqual(turn.input,input)
  assert.equal(turn.collaborationMode.mode,'default')
  assert.equal(turn.collaborationMode.settings.developer_instructions,null)
 }
})
