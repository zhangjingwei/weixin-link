import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {CodexRpc} from '../../../src/base/codex/codex-rpc.mjs'
import {CodexProtocolClient} from '../../../src/base/codex/protocol-client.mjs'
function wire(target){return {closed:false,sent:[],send(message){this.sent.push(message);if(message.method&&message.id!==undefined)queueMicrotask(()=>this.onMessage({id:message.id,result:{target,method:message.method,params:message.params}}))},close(){this.closed=true;this.onClose?.()}}}
test('injected wires use the same protocol and keep concurrent destinations isolated',async()=>{
 const a=wire('local'),b=wire('remote'),local=new CodexRpc({binary:'/must-not-spawn',transport:a}),remote=new CodexRpc({binary:'/must-not-spawn',transport:b})
 try{
  assert(local instanceof CodexProtocolClient);assert(remote instanceof CodexProtocolClient)
  const [x,y]=await Promise.all([local.request('turn/start',{threadId:'local-thread'}),remote.request('turn/start',{threadId:'remote-thread'})])
  assert.equal(x.target,'local');assert.equal(y.target,'remote');assert.equal(x.params.threadId,'local-thread');assert.equal(y.params.threadId,'remote-thread')
  assert.equal(local.child,undefined);assert.equal(remote.child,undefined)
 }finally{local.close();remote.close()}
})
test('shared protocol matches out-of-order replies, reports errors and clears timed-out requests',async()=>{
 const t={send(message){this.sent.push(message)},sent:[],close(){}},rpc=new CodexProtocolClient({transport:t})
 const a=rpc.request('thread/read',{threadId:'a'}),b=rpc.request('fs/readFile',{path:'/remote/file'})
 t.onMessage({id:t.sent[1].id,result:'file'});t.onMessage({id:t.sent[0].id,result:'thread'})
 assert.deepEqual(await Promise.all([a,b]),['thread','file'])
 const failure=rpc.request('turn/start',{});t.onMessage({id:t.sent.at(-1).id,error:{code:403,message:'denied'}})
 await assert.rejects(failure,e=>e.definitiveRpcError&&e.rpcCode===403)
 await assert.rejects(rpc.request('thread/list',{},5),e=>e.requestTimeout&&e.method==='thread/list');assert.equal(rpc.pending.size,0)
 const closed=rpc.request('fs/getMetadata',{});rpc.disconnect();await assert.rejects(closed,e=>e.connectionClosed)
})
test('real stdio transport uses the configured executable and preserves protocol payloads',async()=>{
 const script="require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{target:'stdio-child',method:m.method,params:m.params}})+'\\n')})"
 const rpc=new CodexRpc({binary:process.execPath,providerOptions:{args:['-e',script],thread:{}},cwd:process.cwd()})
 try{const result=await rpc.request('fs/getMetadata',{path:'/explicit/local/path'});assert.equal(result.target,'stdio-child');assert.equal(result.params.path,'/explicit/local/path');assert.notEqual(rpc.child.pid,process.pid)}
 finally{const stopped=once(rpc.child,'close');rpc.close();await stopped}
})
