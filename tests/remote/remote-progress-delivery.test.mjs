import test from 'node:test'
import assert from 'node:assert/strict'
import {createRemoteProgressDelivery} from '../../src/application/remote-tasks/remote-progress-delivery.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'

const chunkId='a'.repeat(64)
const message=(text='进展')=>({scope:'thread',task:'task',seq:1,chunkId,text})
const session={busy:true,workToken:{current:()=>true}}

test('only confirmed progress is deduplicated; repeated text with another fragment ID is delivered',async()=>{
 const sent=[]
 const handler=createRemoteProgressDelivery({findSession:()=>session,verifyTask:async()=>{},deliver:async(_session,text)=>{sent.push(text);return true}})
 assert.deepEqual(await handler(message()),{accepted:true})
 assert.deepEqual(await handler(message()),{accepted:true,duplicate:true})
 assert.deepEqual(await handler({...message(),chunkId:'b'.repeat(64)}),{accepted:true})
 assert.deepEqual(sent,['进展','进展'])
 await assert.rejects(handler(message('不同内容')),/ID_CONFLICT/)
})

test('a concurrent duplicate waits for the actual delivery outcome',async()=>{
 let finish,calls=0
 const handler=createRemoteProgressDelivery({findSession:()=>session,verifyTask:async()=>{},deliver:async()=>{calls++;return new Promise(resolve=>{finish=resolve})}})
 const first=handler(message()),second=handler(message())
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls,1)
 finish(true)
 assert.deepEqual(await first,{accepted:true})
 assert.deepEqual(await second,{accepted:true,duplicate:true})
})

test('failed or uncertain delivery cannot turn a later duplicate into success',async()=>{
 let calls=0
 const handler=createRemoteProgressDelivery({findSession:()=>session,verifyTask:async()=>{},deliver:async()=>{calls++;return false}})
 await assert.rejects(handler(message()),/Delivery not confirmed/)
 await assert.rejects(handler(message()),/DELIVERY_UNCERTAIN/)
 assert.equal(calls,1)
})

test('remote delivery requires accepted rather than deferred status',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']})
 const current={userId:'owner',reply:async()=>({status:'deferred'})}
 assert.equal(await manager.emit(current,'进展'),true)
 assert.equal(await manager.emit(current,'进展',()=>true,true),false)
 manager.close()
})
