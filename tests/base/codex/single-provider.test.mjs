import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionManager,codexProviderOptions} from '../../../src/base/codex/codex-session.mjs'
const retiredEnv={WECHAT_CODEX_FALLBACK_PROVIDER:'retired',WECHAT_CODEX_FALLBACK_MODEL:'retired-model',WECHAT_CODEX_FALLBACK_BASE_URL:'https://retired.example.com'}
async function fixture(t,fail){
 const dir=await mkdtemp(join(tmpdir(),'single-provider-'));t.after(()=>rm(dir,{recursive:true,force:true}));const clients=[],calls=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:retiredEnv,remoteControl:async()=>({}),rpcFactory:options=>{
  const rpc={closed:false,write(){},close(){this.closed=true},async request(method,params){
   calls.push({method,params});const error=fail(method);if(error)throw error
   if(method==='thread/start'||method==='thread/resume')return {thread:{id:params.threadId??'thread'},model:'user-configured',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
   if(method==='turn/start')return {turn:{id:'turn'}}
   return {}
  }};clients.push({rpc,options});return rpc
 }}).init();t.after(()=>manager.close());return {manager,clients,calls}
}
test('legacy backup variables do not configure a second provider',()=>{
 assert.deepEqual(codexProviderOptions(retiredEnv).thread,{})
 assert.equal(codexProviderOptions(retiredEnv).provider,null)
 assert.throws(()=>codexProviderOptions({WECHAT_CODEX_PROVIDER:'custom',WECHAT_CODEX_BASE_URL:'https://custom.example.com'}),/key environment name/)
})
test('a connection failure is reported without opening a backup connection',async t=>{
 const error=Object.assign(Error('configured provider unavailable'),{definitiveRpcError:true})
 const f=await fixture(t,m=>m==='thread/start'?error:null)
 await assert.rejects(f.manager.connect('owner',async()=>{}),e=>e===error)
 assert.equal(f.clients.length,1);assert.equal(f.clients[0].options.provider,'configured')
})
test('an uncertain turn submission is never retried with a new provider or message ID',async t=>{
 const error=Object.assign(Error('connection closed'),{connectionClosed:true})
 const f=await fixture(t,m=>m==='turn/start'?error:null),session=await f.manager.connect('owner',async()=>{})
 await assert.rejects(f.manager.send(session,{text:'authorized request',deliveryId:'original-id'}),e=>e===error)
 assert.equal(f.clients.length,1)
 const starts=f.calls.filter(c=>c.method==='turn/start');assert.equal(starts.length,1);assert.equal(starts[0].params.clientUserMessageId,'original-id')
})
test('a saved thread with unavailable provider is preserved rather than replaced',async t=>{
 const error=Object.assign(Error('model provider retired not found'),{definitiveRpcError:true})
 const f=await fixture(t,m=>m==='thread/resume'?error:null);f.manager.state.users.owner={threadId:'saved-thread',hasMessages:true}
 await assert.rejects(f.manager.connect('owner',async()=>{}),e=>e===error)
 assert.equal(f.manager.state.users.owner.threadId,'saved-thread');assert.equal(f.calls.filter(c=>c.method==='thread/start').length,0)
})
