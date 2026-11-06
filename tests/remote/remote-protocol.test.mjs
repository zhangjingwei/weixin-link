import './remote-test-config.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {RemoteRpc} from '../../src/core/remote-tasks/remote-task-client.mjs'
import {CodexProtocolClient} from '../../src/base/codex/protocol-client.mjs'
function fixture(handler){
 const wires=[],calls=[]
 const rpc=new RemoteRpc('spark',{retryDelays:[1,1],transportFactory:(host,options)=>{
  const t={host,closed:false,responses:[],async connect(){},send(message){
   if(!message.method){this.responses.push(message);return}
   calls.push({host,method:message.method,params:message.params})
   if(message.id===undefined)return
   const result=handler?.(message,t,wires.length-1)
   if(t.closed||result===null)return
   queueMicrotask(()=>t.onMessage({id:message.id,result:result??{target:host,method:message.method,params:message.params}}))
  },close(){if(!this.closed){this.closed=true;options.onDisconnect()}},drop(){this.close()}}
  wires.push(t);return t
 }})
 return {rpc,wires,calls}
}
test('remote sessions use the shared protocol and all operations stay on the selected host wire',async()=>{
 const f=fixture()
 try{
  await f.rpc.connect();assert(f.rpc.client instanceof CodexProtocolClient)
  for(const method of ['thread/start','turn/start','turn/interrupt','fs/readFile','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate']){
   const r=await f.rpc.request(method,{threadId:'remote-thread',path:'/remote/path'})
   assert.equal(r.target,'spark');assert.equal(r.params.threadId,'remote-thread');assert.equal(r.params.path,'/remote/path')
  }
  assert.equal(f.wires.length,1);assert.equal(f.calls.filter(c=>c.method==='initialize').length,1)
  assert.equal(f.rpc.child,undefined)
  const transport=f.wires[0];transport.onMessage({id:'approval',method:'item/commandExecution/requestApproval',params:{command:'dangerous'}})
  assert.equal(transport.responses.at(-1).error.code,-32601)
 }finally{f.rpc.close()}
})
test('a disconnected write reconnects the wire but never replays the write',async()=>{
 const f=fixture((message,t)=>{if(message.method==='turn/start'){t.drop();return null}})
 try{
  await assert.rejects(f.rpc.request('turn/start',{threadId:'owned'}),/REMOTE_REQUEST_UNCERTAIN/)
  await f.rpc.connect();assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.wires.length,2)
 }finally{f.rpc.close()}
})
test('a disconnected read resumes the same thread and retries only the read',async()=>{
 let count=0
 const f=fixture((message,t)=>{
  if(message.method==='thread/resume')return {thread:{id:message.params.threadId,cwd:'/remote/project'}}
  if(message.method==='thread/read'&&count++===0){t.drop();return null}
 })
 f.rpc.setRecovery({threadId:'exact-thread',cwd:'/remote/project'})
 try{const r=await f.rpc.request('thread/read',{threadId:'exact-thread'});assert.equal(r.target,'spark');assert.equal(f.calls.filter(c=>c.method==='thread/read').length,2);assert.equal(f.calls.filter(c=>c.method==='thread/resume'&&c.params.threadId==='exact-thread').length,2)}finally{f.rpc.close()}
})
test('mismatched recovery never redirects a read into another project',async()=>{
 const f=fixture((message,t,index)=>{
  if(message.method==='thread/resume')return {thread:{id:message.params.threadId,cwd:index?'/other/project':'/remote/project'}}
  if(message.method==='thread/read'){t.drop();return null}
 })
 f.rpc.setRecovery({threadId:'exact-thread',cwd:'/remote/project'})
 try{await assert.rejects(f.rpc.request('thread/read',{threadId:'exact-thread'}),/RECOVERY_THREAD_MISMATCH/);assert.equal(f.calls.filter(c=>c.method==='thread/read').length,1)}finally{f.rpc.close()}
})
test('a timed-out write is uncertain and never replayed after reconnect',async()=>{
 const f=fixture(message=>message.method==='turn/start'?null:undefined)
 try{await assert.rejects(f.rpc.request('turn/start',{threadId:'owned'},5),/REMOTE_REQUEST_UNCERTAIN/);await f.rpc.connect();assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.wires.length,2)}finally{f.rpc.close()}
})
