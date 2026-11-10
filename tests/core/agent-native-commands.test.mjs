import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {controlCommand,SessionManager} from '../../src/wechat/session-manager.mjs'
import {createReceiveMessage} from '../../src/application/intake/receive-message.mjs'
import {createMessageApplication} from '../../src/application/intake/message-application.mjs'
import {quoteInput} from '../../src/infrastructure/wechat/weixin-protocol.mjs'
import {remoteScopeId} from '../../src/application/remote-tasks/scope-id.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'

test('native Chinese controls are explicit and slash aliases remain ordinary text',()=>{
  assert.deepEqual(controlCommand('长任务 修复收件队列'),{action:'goal',op:'create',objective:'修复收件队列'})
  assert.deepEqual(controlCommand('长任务 修复收件队列 | 预算 10000'),{action:'goal',op:'create',objective:'修复收件队列',tokenBudget:10000})
  assert.deepEqual(controlCommand('代码审查 对比 origin/main'),{action:'review',target:{type:'baseBranch',branch:'origin/main'}})
  assert.deepEqual(controlCommand('代码审查'),{action:'review',target:{type:'uncommittedChanges'}})
  assert.deepEqual(controlCommand('计划 修复测试'),{action:'plan',text:'修复测试'})
  assert.equal(controlCommand('/review'),null)
  assert.equal(controlCommand('帮我代码审查'),null)
})

async function fixture(kind='codex'){
  const dir=await mkdtemp(join(tmpdir(),'native-command-')),calls=[],output=[]
  const rpcFactory=()=>({closed:false,write(){},close(){this.closed=true},async request(method,params){
    calls.push({method,params})
    if(method==='thread/start'||method==='thread/resume')return {thread:{id:params.threadId??'original',cwd:join(dir,'work')},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never',model:'gpt-test'}
    if(method==='thread/read')return {thread:{id:params.threadId,cwd:join(dir,'work'),status:{type:'idle'}}}
    if(method==='thread/goal/get')return {goal:{objective:'修复队列',status:'active'}}
    if(method==='thread/goal/set')return {goal:{objective:params.objective??'修复队列',status:params.status}}
    if(method==='thread/goal/clear')return {goal:null}
    if(method==='thread/fork')return {thread:{id:'forked',cwd:join(dir,'work')}}
    if(method==='turn/start'||method==='review/start')return {turn:{id:'turn-1'}}
    return {}
  }})
  const manager=await new SessionManager({stateDir:dir,cwd:join(dir,'work'),owners:['owner'],agentKind:kind,rpcFactory}).init()
  const reply=async text=>{output.push(text)}
  return {dir,manager,rpcFactory,calls,output,reply,async close(){manager.close();await rm(dir,{recursive:true,force:true})}}
}

test('Codex goal, fork, plan, review, and fast mode call native RPCs',async()=>{
  const f=await fixture()
  try{
    await f.manager.handle('owner','长任务 修复队列',f.reply)
    assert.deepEqual(f.calls.find(c=>c.method==='thread/goal/set').params,{threadId:'original',origin:'user',objective:'修复队列',status:'active'})
    assert.match(f.output.at(-1),/状态：已启用。/)
    assert.match(f.output.at(-1),/直接发送具体任务才会执行/)
    assert.equal(f.calls.some(c=>c.method==='turn/start'),false)
    await f.manager.handle('owner','长任务状态',f.reply)
    assert.match(f.output.at(-1),/状态：已启用。/)
    await f.manager.handle('owner','开启快速模式',f.reply)
    await f.manager.handle('owner','计划 修复测试',f.reply)
    const turn=f.calls.find(c=>c.method==='turn/start')
    assert.equal(turn.params.collaborationMode.mode,'plan')
    assert.equal(turn.params.serviceTier,'fast')
    f.manager.sessions.get('owner').busy=false;f.manager.sessions.get('owner').state='idle'
    await f.manager.handle('owner','按这个方案实施',f.reply)
    const turns=f.calls.filter(c=>c.method==='turn/start')
    assert.equal(turns.length,2)
    assert.equal(turns[1].params.threadId,turn.params.threadId)
    assert.deepEqual(turns[1].params.collaborationMode,{mode:'default',settings:{model:'gpt-test',reasoning_effort:null,developer_instructions:null}})
    f.manager.sessions.get('owner').busy=false;f.manager.sessions.get('owner').state='idle'
    await f.manager.handle('owner','代码审查',f.reply)
    assert.deepEqual(f.calls.find(c=>c.method==='review/start').params,{threadId:'original',target:{type:'uncommittedChanges'}})
    f.manager.sessions.get('owner').busy=false;f.manager.sessions.get('owner').state='idle'
    await f.manager.handle('owner','分叉会话',f.reply)
    assert.equal(f.manager.state.users.owner.threadId,'forked')
    assert(f.manager.state.users.owner.previous.includes('original'))
    await f.manager.handle('owner','关闭快速模式',f.reply)
    f.manager.sessions.get('owner').busy=false;f.manager.sessions.get('owner').state='idle'
    await f.manager.handle('owner','计划 再检查一次',f.reply)
    assert.equal(f.calls.findLast(c=>c.method==='turn/start').params.serviceTier,'auto')
  }finally{await f.close()}
})
test('review keeps its accepted turn when another turn starts on the same thread',async()=>{
  const f=await fixture()
  try{
    await f.manager.handle('owner','代码审查',f.reply)
    const session=f.manager.sessions.get('owner')
    session.reply=async text=>{f.output.push(text);return {status:'accepted'}}
    assert.equal(session.turnId,'turn-1')
    await f.manager.event(session,{method:'turn/started',params:{threadId:'original',turn:{id:'nested-review-turn'}}})
    assert.equal(session.turnId,'turn-1')
    await f.manager.event(session,{method:'item/completed',params:{threadId:'original',turnId:'turn-1',item:{id:'review-progress',type:'agentMessage',phase:'commentary',text:'审查正在检查改动。'}}})
    assert.equal(session.lastProgress?.text,'审查正在检查改动。')
    assert(f.output.some(text=>text.includes('审查正在检查改动。')))
  }finally{await f.close()}
})

test('Claude rejects unsupported native commands without calling its RPC',async()=>{
  const f=await fixture('claude')
  try{
    await f.manager.handle('owner','长任务 修复队列',f.reply)
    assert.match(f.output[0],/未接入.*没有执行/)
    assert.equal(f.calls.length,0)
  }finally{await f.close()}
})

test('goal lifecycle, compaction and side branch stay within the owner session',async()=>{
  const f=await fixture()
  try{
    await f.manager.handle('owner','暂停长任务',f.reply)
    await f.manager.handle('owner','继续长任务',f.reply)
    await f.manager.handle('owner','完成长任务',f.reply)
    await f.manager.handle('owner','清除长任务',f.reply)
    assert.deepEqual(f.calls.filter(c=>c.method==='thread/goal/set').map(c=>c.params.status),['paused','active','complete'])
    assert.equal(f.calls.find(c=>c.method==='thread/goal/clear').params.origin,'user')
    await f.manager.handle('owner','压缩上下文',f.reply)
    assert.equal(f.calls.find(c=>c.method==='thread/compact/start').params.threadId,'original')
    await f.manager.handle('owner','旁支会话',f.reply)
    assert.equal(f.manager.state.users.owner.threadId,'original')
    assert(f.manager.state.users.owner.previous.includes('forked'))
    const before=f.calls.length
    await f.manager.handle('stranger','长任务 非法请求',f.reply)
    assert.equal(f.calls.length,before)
  }finally{await f.close()}
})

test('plan and review ingress are captured before dispatch and retain their ingress id',async()=>{
  const captured=[],dispatched=[]
  const jobs={backendKey:'test',findCaptured:()=>null,capture:message=>{captured.push(message.text);return 'ingress-'+captured.length}}
  const receiver=createReceiveMessage({manager:{save:async()=>{},lifecycle:{capture:()=>({current:()=>true})}},jobs,view:{},dispatch:message=>dispatched.push(message),hasMedia:()=>false,conversations:{bind:message=>message,realOwners:new Set(['owner'])},runtime:{sealed:false},setupController:{command:()=>null},setupReceipts:{get:()=>null},normalizeVoice:message=>message,classifyMessage:message=>{const value=controlCommand(message.text);return value?{kind:'session',value}:null}})
  const message={userId:'owner',text:'计划 修复测试',raw:{message_id:'one'}}
  await receiver.captureBatch([message,{userId:'owner',text:'状态',raw:{message_id:'two'}}])
  assert.deepEqual(captured,['计划 修复测试'])
  receiver.onMessage(message)
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(dispatched[0]._ingressId,'ingress-2')
})

test('state-changing native controls are captured before cursor checkpoint',async()=>{
  const captured=[]
  const receiver=createReceiveMessage({manager:{save:async()=>{}},jobs:{capture:message=>captured.push(message.text)},classifyMessage:message=>{const value=controlCommand(message.text);return value?{kind:'session',value}:null}})
  await receiver.captureBatch(['长任务 修复队列','暂停长任务','分叉会话','压缩上下文','开启快速模式','长任务状态','Codex状态'].map(text=>({text})))
  assert.deepEqual(captured,['长任务 修复队列','暂停长任务','分叉会话','压缩上下文','开启快速模式'])
})

test('cancelling a task while compaction is active does not submit a turn',async()=>{
  const f=await fixture()
  try{
    const session=await f.manager.connect('owner',f.reply)
    session.compacting=true
    const original=session.rpc.request.bind(session.rpc)
    session.rpc.request=(method,params)=>method==='thread/read'?Promise.resolve({thread:{id:session.threadId,status:{type:'active'}}}):original(method,params)
    let current=true
    const pending=f.manager.send(session,{text:'计划内容',nativeCommand:{action:'plan'}},{current:()=>current})
    current=false
    await assert.rejects(pending,/已取消/)
    assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0)
  }finally{await f.close()}
})

test('failed compaction status check leaves the queued task unsubmitted',async()=>{
  const f=await fixture()
  try{
    const session=await f.manager.connect('owner',f.reply)
    session.compacting=true
    session.rpc.request=async method=>{if(method==='thread/read')throw Error('RPC unavailable');throw Error('Unexpected RPC')}
    await assert.rejects(f.manager.send(session,'继续'),error=>error.code==='COMPACTION_CHECK_FAILED')
    const job={id:'job',owner:'owner',input:{text:'继续'},state:'pending'},notices=[]
    const jobs={pending:()=>job.state==='pending'?[job]:[],mark:(_id,state)=>{job.state=state}}
    const manager={sessions:new Map(),state:{users:{owner:{}}},lifecycle:{capture:()=>({current:()=>true})},ask:async()=>{throw Object.assign(Error('压缩状态核对失败，本条任务未提交。'),{code:'COMPACTION_CHECK_FAILED'})}}
    await new DurableIntake({jobs,manager,reply:async(_owner,text)=>notices.push(text)}).pump('owner')
    assert.equal(job.state,'cancelled')
    assert.match(notices[0],/未提交/)
  }finally{await f.close()}
})

test('fork cannot switch away from an unconfirmed remote task',async()=>{
  const f=await fixture()
  try{
    await f.manager.connect('owner',f.reply)
    const scope=createHash('sha256').update('original').digest('hex').slice(0,24)
    await writeFile(join(f.dir,'work','remote-sessions.json'),JSON.stringify({task:{kind:'official-remote-task',scope,stop_confirmed:false}}))
    await f.manager.handle('owner','分叉会话',f.reply)
    assert.equal(f.calls.filter(c=>c.method==='thread/fork').length,0)
    assert.equal(f.manager.state.users.owner.threadId,'original')
    assert.match(f.output.at(-1),/远程任务/)
  }finally{await f.close()}
})

test('fork checks the account-scoped remote task ledger',async()=>{
  const previous=process.env.WECHAT_ACCOUNT
  process.env.WECHAT_ACCOUNT='secondary'
  const f=await fixture()
  try{
    await f.manager.connect('owner',f.reply)
    const scope=remoteScopeId('original','secondary')
    assert.notEqual(scope,remoteScopeId('original','default'))
    await writeFile(join(f.dir,'work','remote-sessions.json'),JSON.stringify({task:{kind:'official-remote-task',scope,account:'secondary',stop_confirmed:false}}))
    await f.manager.handle('owner','分叉会话',f.reply)
    assert.equal(f.calls.filter(c=>c.method==='thread/fork').length,0)
    await writeFile(join(f.dir,'work','remote-sessions.json'),JSON.stringify({legacy:{kind:'official-remote-task',scope:remoteScopeId('original','default'),stop_confirmed:true}}))
    await f.manager.handle('owner','分叉会话',f.reply)
    assert.equal(f.calls.filter(c=>c.method==='thread/fork').length,0)
    assert.match(f.output.at(-1),/归属不明/)
  }finally{await f.close();if(previous===undefined)delete process.env.WECHAT_ACCOUNT;else process.env.WECHAT_ACCOUNT=previous}
})

test('compaction intent survives restart and is cleared after the thread is idle',async()=>{
  const f=await fixture()
  let restarted
  try{
    await f.manager.handle('owner','压缩上下文',f.reply)
    assert.equal(f.manager.state.users.owner.compaction.threadId,'original')
    restarted=await new SessionManager({stateDir:f.dir,cwd:join(f.dir,'work'),owners:['owner'],rpcFactory:f.rpcFactory}).init()
    const session=await restarted.connect('owner',f.reply)
    assert.equal(session.compacting,true)
    await restarted.send(session,'继续检查')
    assert.equal(restarted.state.users.owner.compaction,undefined)
    assert(f.calls.some(c=>c.method==='turn/start'))
  }finally{restarted?.close();await f.close()}
})

test('stop does not claim an unconfirmed compaction was cancelled',async()=>{
  const f=await fixture()
  try{
    await f.manager.handle('owner','压缩上下文',f.reply)
    await f.manager.handle('owner','停止',f.reply)
    assert(f.output.some(value=>value.includes('未确认取消压缩')))
    assert.equal(f.manager.state.users.owner.compaction.threadId,'original')
  }finally{await f.close()}
})

test('fast mode remains explicit after restoring an owned Codex session',async()=>{
  const f=await fixture()
  try{
    await f.manager.handle('owner','开启快速模式',f.reply)
    f.manager.state.users.owner.previous=['older']
    await f.manager.handle('owner','恢复Codex会话 older',f.reply)
    assert.equal(f.manager.state.users.owner.fastMode,true)
    await f.manager.handle('owner','计划 检查',f.reply)
    assert.equal(f.calls.findLast(c=>c.method==='turn/start').params.serviceTier,'fast')
  }finally{await f.close()}
})

test('quoted WeChat plan keeps the referenced message in the durable task',async()=>{
  const submissions=[]
  const manager={owners:new Set(['owner']),sessions:new Map(),state:{users:{owner:{}}},supportsNativeCommands:true,agentName:'Codex',lifecycle:{capture:()=>({current:()=>true})},acceptMessage:async()=>true}
  const handle=createMessageApplication({view:{context(){},deliver:async()=>{}},manager,jobs:{rawCurrent:()=>true,acknowledge(){},claimReceipt:()=>false},conversations:{recipient:()=> 'owner',control:async()=>false},runtime:{sealed:false,draining:false},log(){},durable:{submit:(...args)=>submissions.push(args)},classifyMessage:message=>({kind:'session',value:controlCommand(message.text)}),hasMedia:()=>false,normalizeVoice:message=>message,quoteInput,systemNotice:value=>value})
  const references=[{messageId:'42',text:'原始需求'}]
  await handle({userId:'owner',text:'计划 修复这个问题',references,raw:{message_id:'43'},_ingressId:'ingress-43'})
  assert.equal(submissions.length,1)
  assert.equal(submissions[0][1].text,'修复这个问题')
  assert.deepEqual(submissions[0][1].references,references)
})

test('replayed native mutation reports unknown outcome without sending the RPC again',async()=>{
  const notices=[],acknowledged=[]
  const manager={owners:new Set(['owner']),sessions:new Map(),state:{users:{owner:{}}},lifecycle:{capture:()=>({current:()=>true})},handle:()=>{throw Error('mutation replayed')}}
  const handle=createMessageApplication({view:{context(){},deliver:async(_owner,text)=>{notices.push(text);return {status:'accepted'}}},manager,jobs:{rawCurrent:()=>true,acknowledge:ids=>acknowledged.push(...ids)},conversations:{recipient:()=> 'owner'},runtime:{sealed:false,draining:false,track:(_kind,work)=>work()},log(){},classifyMessage:message=>({kind:'session',value:controlCommand(message.text)}),hasMedia:()=>false,normalizeVoice:message=>message})
  await handle({userId:'owner',text:'分叉会话',raw:{message_id:'44'},_ingressId:'ingress-44',_recovered:true})
  assert.match(notices[0],/未重复执行/)
  assert.deepEqual(acknowledged,['ingress-44'])
})
