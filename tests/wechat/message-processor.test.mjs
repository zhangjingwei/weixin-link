import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageProcessor} from '../../src/wechat/message-processor.mjs'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WELCOME_MESSAGE} from '../../src/wechat/welcome-guide.mjs'
function fixture(){
 const sent=[],acked=[],submitted=[]
 const token={current:()=>true},deps={
  stateDir:'/nonexistent-wechat-diagnostic-test',bot:{contextStore:new Map()},manager:{owners:new Set(['owner']),sessions:new Map([['owner',{}]]),state:{users:{owner:{}}},lifecycle:{capture:()=>token}},
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
test('diagnostic controls bypass missing model/backend and never submit inference',async()=>{
 const f=fixture();f.deps.stateDir='/nonexistent-wechat-diagnostic-test';f.deps.manager.sessions.clear();f.deps.backend.kind='podman';f.deps.backend.preflight=()=>{throw Error('must not invoke backend')};f.deps.runtime.track=async(kind,fn)=>fn()
 await f.handle({userId:'owner',text:'查看最近错误',_ingressId:'diagnostic-id'})
 assert.equal(f.submitted.length,0);assert.deepEqual(f.acked,['diagnostic-id']);assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/诊断日志|诊断未完成/)
})
async function onboarding(t){
 const f=fixture();f.deps.stateDir=await mkdtemp(join(tmpdir(),'wechat-welcome-'))
 t.after(()=>rm(f.deps.stateDir,{recursive:true,force:true}))
 f.deps.welcomePending=true
 f.deps.jobs.claimReceipt=()=>true
 f.handle=createMessageProcessor(f.deps)
 return f
}
test('first greeting sends one short welcome with no receipt or model turn',async t=>{
 const f=await onboarding(t)
 await f.handle({userId:'owner',text:'你好',_ingressId:'hello'})
 assert.deepEqual(f.sent,[['owner',WELCOME_MESSAGE]])
 assert(WELCOME_MESSAGE.length<200)
 assert.deepEqual(f.acked,['hello']);assert.equal(f.submitted.length,0)
 await f.handle({userId:'owner',text:'你好',_ingressId:'hello-again'})
 assert.equal(f.sent.filter(([,text])=>text===WELCOME_MESSAGE).length,1)
 assert.equal(f.submitted.length,1)
})
test('a first substantive request goes to the model without unsolicited instructions',async t=>{
 const f=await onboarding(t)
 await f.handle({userId:'owner',text:'你好，帮我整理文件',_ingressId:'request'})
 assert.equal(f.submitted.length,1)
 assert(!f.sent.some(([,text])=>text===WELCOME_MESSAGE))
 assert.deepEqual(await readdir(f.deps.stateDir),[])
})
test('explicit setup commands do not trigger an extra welcome',async t=>{
 const f=await onboarding(t)
 f.deps.setupReceipts={capture:()=>({id:'receipt'}),claim:()=>true,finish:()=>{}}
 f.deps.setupController={handle:async(action,reply)=>reply('安装状态结果')}
 f.deps.runtime.track=async(kind,fn)=>fn()
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'安装状态',_setupAction:'status',_ingressId:'status'})
 assert.deepEqual(f.sent,[['owner','安装状态结果']]);assert.equal(f.submitted.length,0)
})
