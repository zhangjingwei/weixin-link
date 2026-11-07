import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageProcessor} from '../../src/wechat/message-processor.mjs'
function fixture(){
 const sent=[],acked=[],submitted=[]
 const token={current:()=>true},deps={
  stateDir:'/nonexistent-wechat-diagnostic-test',bot:{contextStore:new Map()},manager:{owners:new Set(['owner']),sessions:new Map([['owner',{}]]),state:{users:{owner:{}}},lifecycle:{capture:()=>token}},
  jobs:{rawCurrent:()=>true,acknowledge:ids=>acked.push(...ids),claimReceipt:()=>false},
  conversations:{recipient:id=>id,control:async()=>false},runtime:{sealed:false,draining:false},log:()=>{},
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
 assert.deepEqual(f.sent,[['owner','pong\n〔系统通知〕']]);assert.deepEqual(f.acked,['ping-id'])
 await f.handle({userId:'owner',text:'normal request',_ingressId:'request-id'})
 assert.equal(f.submitted.length,1);assert.equal(f.submitted[0][0],'owner');assert.equal(f.submitted[0][2],'request-id')
})
test('diagnostic controls bypass missing model/backend and never submit inference',async()=>{
 const f=fixture();f.deps.stateDir='/nonexistent-wechat-diagnostic-test';f.deps.manager.sessions.clear();f.deps.backend.kind='podman';f.deps.backend.preflight=()=>{throw Error('must not invoke backend')};f.deps.runtime.track=async(kind,fn)=>fn()
 await f.handle({userId:'owner',text:'查看最近错误',_ingressId:'diagnostic-id'})
 assert.equal(f.submitted.length,0);assert.deepEqual(f.acked,['diagnostic-id']);assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/诊断日志|诊断未完成/)
})
test('agent switch command bypasses inference and acknowledges after the reply',async()=>{
 const f=fixture(),events=[]
 f.deps.runtime.track=async(kind,work)=>{events.push('track:'+kind);return work()}
 f.deps.manager.acceptMessage=async()=>true
 f.deps.agentSwitcher={handle:async(command,reply)=>{events.push(command.target);await reply('切换请求已安排')}}
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'切换智能体 Claude',_ingressId:'agent-switch-id'})
 assert.deepEqual(f.sent,[['owner','切换请求已安排']])
 assert.deepEqual(f.acked,['agent-switch-id'])
 assert.deepEqual(f.submitted,[])
 assert(events.includes('track:setup'))
})
test('short restart and upgrade commands bypass inference and acknowledge after reply',async()=>{
 const f=fixture(),actions=[]
 f.deps.runtime.track=async(kind,work)=>work();f.deps.manager.acceptMessage=async()=>true
 f.deps.agentSwitcher={handle:async(command,reply)=>{actions.push(command.action);await reply('重启已安排')}}
 f.deps.upgrader={handle:async reply=>{actions.push('upgrade');await reply('升级已安排')}}
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'重启',_ingressId:'restart-id'})
 await f.handle({userId:'owner',text:'升级',_ingressId:'upgrade-id'})
 assert.deepEqual(actions,['restart','upgrade']);assert.deepEqual(f.acked,['restart-id','upgrade-id']);assert.deepEqual(f.submitted,[])
})
test('recovered maintenance commands are not submitted again',async()=>{
 const f=fixture();f.deps.runtime.track=async(kind,work)=>work()
 f.deps.agentSwitcher={handle:async()=>{throw Error('must not restart')}}
 f.deps.upgrader={handle:async()=>{throw Error('must not upgrade')}}
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'重启',_recovered:true,_ingressId:'restart-recovered'})
 await f.handle({userId:'owner',text:'升级',_recovered:true,_ingressId:'upgrade-recovered'})
 assert.deepEqual(f.acked,['restart-recovered','upgrade-recovered']);assert.equal(f.sent.length,2);assert.deepEqual(f.submitted,[])
})
test('a new ordinary message resends a definitively rejected prior text result before submission',async()=>{
 const f=fixture(),record=f.deps.manager.state.users.owner
 record.lastReply='上轮最终答复\n✅ 本轮回答结束。'
 record.recovery={execution:'completed',delivery:'failed',delivery_error:{api_code:-2}}
 f.deps.manager.save=async()=>{}
 f.deps.outgoing.deliver=async(id,value)=>{f.sent.push([id,value]);return {status:'accepted'}}
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'为什么没收到结束消息',_ingressId:'new-message'})
 assert.match(f.sent[0][1],/上轮最终答复/)
 assert.equal(record.recovery.delivery,'accepted');assert.equal(f.submitted.length,1)
})
test('inbound lifecycle notice precedes normal message processing',async()=>{
 const f=fixture(),events=[]
 f.deps.lifecycleNotice={onInbound:async owner=>events.push('notice:'+owner)}
 f.deps.durable.submit=()=>events.push('submit')
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'你好，帮我整理文件',_ingressId:'request'})
 assert.deepEqual(events,['notice:owner','submit'])
})
test('an accepted lifecycle notice replaces the routine receipt',async()=>{
 const f=fixture()
 f.deps.lifecycleNotice={onInbound:async()=> 'accepted'}
 f.deps.jobs.claimReceipt=()=>true
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'继续检查',_ingressId:'request'})
 assert.deepEqual(f.sent,[])
 assert.equal(f.submitted.length,1)
})
test('explicit setup commands continue without a duplicate welcome',async()=>{
 const f=fixture()
 f.deps.setupReceipts={capture:()=>({id:'receipt'}),claim:()=>true,finish:()=>{}}
 f.deps.setupController={handle:async(action,reply)=>reply('安装状态结果')}
 f.deps.runtime.track=async(kind,fn)=>fn()
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'安装状态',_setupAction:'status',_ingressId:'status'})
 assert.deepEqual(f.sent,[['owner','安装状态结果']]);assert.equal(f.submitted.length,0)
})
