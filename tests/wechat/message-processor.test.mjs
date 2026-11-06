import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageProcessor} from '../../src/wechat/message-processor.mjs'
function fixture(){
 const sent=[],acked=[],submitted=[]
 const token={current:()=>true},deps={
  bot:{contextStore:new Map()},manager:{owners:new Set(['owner']),sessions:new Map([['owner',{}]]),state:{users:{owner:{}}},lifecycle:{capture:()=>token}},
  jobs:{rawCurrent:()=>true,acknowledge:ids=>acked.push(...ids),claimReceipt:()=>false},
  conversations:{recipient:id=>id,control:async()=>false},runtime:{sealed:false,draining:false},log:()=>{},welcomePending:false,
  backend:{kind:'host'},owners:['owner'],outgoing:{deliver:async(id,value)=>sent.push([id,value])},durable:{submit:(...args)=>submitted.push(args)}
 }
 return {deps,sent,acked,submitted,handle:createMessageProcessor(deps)}
}
test('extracted message processor rejects unauthorized, cancelled and stale messages without side effects',async()=>{
 const f=fixture()
 await f.handle({userId:'stranger',text:'ping'})
 await f.handle({userId:'owner',text:'ping',_intakeToken:{current:()=>false}})
 f.deps.jobs.rawCurrent=()=>false;await f.handle({userId:'owner',text:'ping',_ingressId:'stale'})
 assert.deepEqual(f.sent,[]);assert.deepEqual(f.acked,[]);assert.deepEqual(f.submitted,[])
})
test('extracted processor retains ping handling and durable ordinary submission',async()=>{
 const f=fixture();await f.handle({userId:'owner',text:'ping',_ingressId:'ping-id'})
 assert.deepEqual(f.sent,[['owner','pong']]);assert.deepEqual(f.acked,['ping-id'])
 await f.handle({userId:'owner',text:'normal request',_ingressId:'request-id'})
 assert.equal(f.submitted.length,1);assert.equal(f.submitted[0][0],'owner');assert.equal(f.submitted[0][2],'request-id')
})
