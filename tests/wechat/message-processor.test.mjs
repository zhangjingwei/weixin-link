import test from 'node:test'
import assert from 'node:assert/strict'
import {createMessageProcessor} from '../../src/wechat/message-processor.mjs'
import {createInfrastructurePorts} from '../../src/wechat/infrastructure-ports.mjs'
function fixture(){
 const sent=[],acked=[],submitted=[]
 const token={current:()=>true},deps={
  infrastructure:createInfrastructurePorts(),
  stateDir:'/nonexistent-wechat-diagnostic-test',bot:{contextStore:new Map()},manager:{owners:new Set(['owner']),sessions:new Map([['owner',{}]]),state:{users:{owner:{}}},lifecycle:{capture:()=>token}},
  jobs:{rawCurrent:()=>true,acknowledge:ids=>acked.push(...ids),claimReceipt:()=>false},
  conversations:{recipient:id=>id,control:async()=>false},runtime:{sealed:false,draining:false},log:()=>{},
  backend:{kind:'host'},owners:['owner'],outgoing:{deliver:async(id,value)=>sent.push([id,value])},durable:{submit:(...args)=>submitted.push(args)}
 }
 deps.view={
  context:(userId,value)=>{if(value)deps.bot.contextStore.set(deps.conversations.recipient(userId),value)},
  deliver:(...args)=>deps.outgoing.deliver(...args),
  directNotice:(message,text)=>deps.runtime.track('delivery',()=>deps.bot.reply({...message,userId:deps.conversations.recipient(message.userId)},text)),
  sensitive:(userId,text)=>deps.runtime.track('delivery',()=>deps.bot.sendSensitiveText(deps.conversations.recipient(userId),text)),
 }
 return {deps,sent,acked,submitted,handle:createMessageProcessor(deps)}
}
test('message processor requires infrastructure ports from its caller',()=>{
 const {deps}=fixture()
 assert.throws(()=>createMessageProcessor({...deps,infrastructure:undefined}),/MESSAGE_PORT_INVALID/)
})
test('extracted message processor rejects unauthorized, cancelled and stale messages without side effects',async()=>{
 const f=fixture()
 await f.handle({userId:'stranger',text:'ping'})
 await f.handle({userId:'owner',text:'ping',_intakeToken:{current:()=>false}})
 f.deps.jobs.rawCurrent=()=>false;await f.handle({userId:'owner',text:'ping',_ingressId:'stale'})
 assert.deepEqual(f.sent,[]);assert.deepEqual(f.acked,[]);assert.deepEqual(f.submitted,[])
})
test('extracted processor retains ping handling and durable ordinary submission',async()=>{
 const f=fixture();await f.handle({userId:'owner',text:'ping',_ingressId:'ping-id'})
 assert.deepEqual(f.sent,[['owner','pong 〔系统通知〕']]);assert.deepEqual(f.acked,['ping-id'])
 await f.handle({userId:'owner',text:'normal request',_ingressId:'request-id'})
 assert.equal(f.submitted.length,1);assert.equal(f.submitted[0][0],'owner');assert.equal(f.submitted[0][2],'request-id')
})
test('maintenance keeps persisted messages pending for replay after drain',async()=>{
 const f=fixture(),deferred=[]
 f.deps.runtime={sealed:false,draining:true,track:async(_kind,work)=>work()}
 f.deps.bot.reply=async()=>{throw Error('delivery uncertain')}
 f.deps.deferMaintenance=message=>deferred.push(message)
 f.handle=createMessageProcessor(f.deps)
 const message={userId:'owner',text:'继续任务',_ingressId:'maintenance-id'}
 await f.handle(message)
 assert.deepEqual(deferred,[message]);assert.deepEqual(f.acked,[]);assert.deepEqual(f.submitted,[])
})
test('inbound trace is retained through message logging and durable submission',async()=>{
 const f=fixture(),events=[];f.deps.log=(event,fields)=>events.push({event,...fields});f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'请检查',_traceId:'message-trace-123',_ingressId:'request-id'})
 assert.equal(events.find(e=>e.event==='message.received').trace_id,'message-trace-123')
 assert.equal(f.submitted[0][1].traceId,'message-trace-123')
})
test('diagnostic controls bypass missing model/backend and never submit inference',async()=>{
 const f=fixture();f.deps.stateDir='/nonexistent-wechat-diagnostic-test';f.deps.manager.sessions.clear();f.deps.backend.kind='remote';f.deps.backend.preflight=()=>{throw Error('must not invoke backend')};f.deps.runtime.track=async(kind,fn)=>fn()
 await f.handle({userId:'owner',text:'查看最近错误',_ingressId:'diagnostic-id'})
 assert.equal(f.submitted.length,0);assert.deepEqual(f.acked,['diagnostic-id']);assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/诊断日志|诊断未完成/)
})
test('restart command bypasses inference and acknowledges after the reply',async()=>{
 const f=fixture(),events=[]
 f.deps.runtime.track=async(kind,work)=>{events.push('track:'+kind);return work()}
 f.deps.manager.acceptMessage=async()=>true
 f.deps.agentSwitcher={handle:async(command,reply)=>{events.push(command.target);await reply('切换请求已安排')}}
 f.handle=createMessageProcessor(f.deps)
 await f.handle({userId:'owner',text:'重启',_ingressId:'agent-switch-id'})
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

test('voice status enters normal model intake and stop bypasses maintenance gating',async()=>{
 const f=fixture(),handled=[]
 f.deps.manager.acceptMessage=async()=>true;f.deps.manager.handle=async(owner,text)=>handled.push([owner,text])
 f.handle=createMessageProcessor(f.deps)
 const voice=text=>({userId:'owner',type:'voice',text:'[voice]',voices:[{text}],_ingressId:text,raw:{item_list:[{voice_item:{text}}]}})
 await f.handle(voice('状态。'))
 f.deps.runtime.draining=true;await f.handle(voice('停止。'))
 assert.deepEqual(handled,[['owner','停止']]);assert.deepEqual(f.submitted.map(args=>args[1].text),['状态。'])
})
test('voice upgrade uses maintenance handler and recovered request does not repeat',async()=>{
 const f=fixture();let calls=0
 f.deps.manager.acceptMessage=async()=>true;f.deps.runtime.track=async(kind,work)=>work()
 f.deps.upgrader={handle:async()=>{calls++}};f.handle=createMessageProcessor(f.deps)
 const message={userId:'owner',type:'voice',text:'[voice]',voices:[{text:'升级。'}],_ingressId:'voice-upgrade'}
 await f.handle(message);await f.handle({...message,_recovered:true})
 assert.equal(calls,1);assert.deepEqual(f.submitted,[]);assert.match(f.sent[0][1],/没有重复执行/)
})

test('standalone greeting replies locally once, even when the model is unavailable',async()=>{
 const f=fixture(),claims=new Set()
 f.deps.manager.sessions.clear()
 f.deps.entryRouting={process:async()=>assert.fail('unexpected model routing')}
 f.deps.jobs.claimReceipt=id=>!claims.has(id)&&!!claims.add(id)
 f.deps.outgoing.deliver=async(id,text)=>{f.sent.push([id,text]);return {status:'unknown'}}
 const handle=createMessageProcessor(f.deps)
 const message={userId:'owner',text:'你好！',_ingressId:'hello'}
 await handle(message)
 await handle({...message,_recovered:true})
 assert.deepEqual(f.sent,[['owner','你好！有什么可以帮你？']])
 assert.deepEqual(f.submitted,[])
})

test('greetings with requests, quotes or pending clarification retain normal routing',async()=>{
 const f=fixture(),routed=[]
 f.deps.entryRouting={process:async message=>{routed.push(message._ingressId);return true}}
 const handle=createMessageProcessor(f.deps)
 const base={userId:'owner',text:'你好'}
 await handle({...base,text:'你好，帮我整理文件',_ingressId:'task'})
 await handle({...base,references:[{text:'之前的问题'}],_ingressId:'quote'})
 f.deps.manager.state.textConversations={owner:{entryClarification:{question:'哪个项目？'}}}
 await handle({...base,_ingressId:'clarification'})
 assert.deepEqual(routed,['task','quote','clarification'])
 assert.deepEqual(f.sent,[])
})

test('bare continue confirms only one captured desktop request; ambiguous or ordinary text never quits',async()=>{
 const f=fixture(),confirmed=[]
 f.deps.runtime.track=(_,fn)=>fn()
 f.deps.durable.confirmDesktop=async(_,action,code)=>confirmed.push([action,code])
 f.deps.jobs.desktopJob=(_,code)=>({input:{text:'任务 '+code}})
 const msg={userId:'owner',text:'继续'}
 await f.handle({...msg,_desktopChoices:['aaaaaaaa']})
 await f.handle({...msg,_desktopChoices:['aaaaaaaa','bbbbbbbb']})
 await f.handle({...msg,_desktopChoices:[]})
 assert.deepEqual(confirmed,[['继续','aaaaaaaa']])
 assert.match(f.sent[0][1],/继续 bbbbbbbb/)
 assert.equal(f.submitted.length,1)
})

test('关闭桌面端 dispatches the desktop quit tool once for the captured thread',async()=>{
 const {createReceiveMessage}=await import('../../src/application/intake/receive-message.mjs')
 const f=fixture(),calls=[]
 Object.assign(f.deps.manager.state.users.owner,{threadId:'thread'})
 Object.assign(f.deps.jobs,{findCaptured:()=>null,claimReceipt:()=>!calls.length})
 f.deps.runtime.track=(_,fn)=>fn()
 f.deps.durable.quitDesktop=async message=>calls.push(message._desktopQuit.threadId)
 const receiver=createReceiveMessage({...f.deps,conversations:{bind:m=>m},normalizeVoice:m=>m,hasMedia:()=>false,setupReceipts:{get:()=>null},setupController:{command:()=>null}})
 const prepare=references=>receiver.prepare({userId:'owner',text:'关闭桌面端'},{traceId:'test',quote:()=>references})
 assert.equal(prepare([{text:'quoted'}])._desktopQuit,undefined)
 const captured={...prepare([]),_ingressId:'quit-id'}
 await f.handle(captured)
 await f.handle(captured)
 assert.deepEqual(calls,['thread'])
 assert.deepEqual(f.submitted,[])
})

test('text and voice result lookups reach the model without replaying a rejected previous reply',async()=>{
 const f=fixture(),record=f.deps.manager.state.users.owner
 record.lastReply='上一轮回答'
 record.recovery={execution:'completed',delivery:'failed',delivery_error:{api_code:-2}}
 f.deps.manager.save=async()=>{}
 for(const text of ['结果','RESULT?']){
  await f.handle({userId:'owner',text,_ingressId:text})
 }
 const transcript='结果。'
 await f.handle({userId:'owner',type:'voice',text:'[voice]',voices:[{text:transcript}],_ingressId:'voice-result',raw:{item_list:[{voice_item:{text:transcript}}]}})
 assert.deepEqual(f.submitted.map(args=>args[1].text),['结果','RESULT?',transcript])
 assert.deepEqual(f.sent,[])
 assert.equal(record.recovery.autoResend,undefined)
 assert.equal(record.recovery.delivery,'failed')
})

test('first message with no live session goes straight to durable intake',async()=>{
 const f=fixture(),events=[]
 f.deps.manager.sessions.clear()
 f.deps.log=event=>events.push(event)
 const handle=createMessageProcessor(f.deps)
 await handle({userId:'owner',text:'请检查当前项目',_ingressId:'cold-start'})
 assert.equal(f.submitted.length,1)
 assert.equal(f.submitted[0][2],'cold-start')
 assert(!events.some(event=>event.startsWith('agent.readiness')))
})
