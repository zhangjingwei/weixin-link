import {ASSISTANT_INSTRUCTIONS} from '../../../src/infrastructure/agents/assistant-policy.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager as ActualSessionManager } from '../../../src/wechat/session-manager.mjs'
import {codexProviderOptions} from '../../../src/base/codex/provider-options.mjs'

// Fake-RPC tests must not inherit live provider settings or contact remote hosts.
class SessionManager extends ActualSessionManager { constructor(options){super({providerEnv:{},remoteControl:async()=>({stop_confirmed:true,tasks:[]}),...options})} }

test('custom provider profile overrides resumed model and disables unsupported search', () => {
  const options=codexProviderOptions({WECHAT_CODEX_BASE_URL:'https://provider.example.com',WECHAT_CODEX_MODEL:'configured-model',WECHAT_CODEX_PROVIDER:'custom',WECHAT_CODEX_API_KEY_ENV:'CUSTOM_API_KEY',WECHAT_CODEX_REASONING_EFFORT:'high',WECHAT_CODEX_WEB_SEARCH:'disabled'})
  assert.deepEqual(options.thread,{model:'configured-model',modelProvider:'custom',reasoningEffort:'high'})
  assert.ok(options.args.includes('web_search="disabled"'))
  assert.ok(options.args.includes('model_provider="custom"'))
  assert.ok(options.args.includes('model_reasoning_effort="high"'))
  assert.throws(()=>codexProviderOptions({WECHAT_CODEX_REASONING_EFFORT:'unsafe value'}))
  assert.deepEqual(codexProviderOptions({},{subscriptionTransport:'auto'}).thread,{})
  assert.throws(()=>codexProviderOptions({WECHAT_CODEX_PROVIDER:'bad/path'}))
})

test('owner isolation, deduplication, queue, stop, questions, persistence, and failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-session-'))
  const clients = []
  const output = []
  let threadCount = 0
  const options = {
    stateDir: dir, cwd: join(dir, 'work'), owners: ['owner', 'other'],
    providerEnv: {}, // Isolate from this machine's live provider settings.
    // This is a fake-RPC unit test; never call the live remote stop adapter.
    remoteControl: async()=>({stop_confirmed:true,tasks:[]}),
    rpcFactory({ onEvent, onClose }) {
      const rpc = { closed: false, calls: [], answers: [], event: onEvent,
        async request(method, params) {
          this.calls.push({ method, params })
          if (method === 'thread/start' || method === 'thread/resume') {
            assert.equal(params.sandbox, 'danger-full-access')
            assert.ok(params.developerInstructions.startsWith(ASSISTANT_INSTRUCTIONS))
            assert.doesNotMatch(params.developerInstructions,/description:|📋 Zero · 方案共识/)
            assert.equal(this.calls.filter(call=>call.method==='skills/extraRoots/set').length,1)
            assert.ok(params.developerInstructions.includes('本会话临时交付目录：'))
            return { thread: { id: params.threadId ?? `thread-${++threadCount}` }, sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never' }
          }
          if (method === 'turn/start') {
            const turn = { id: `turn-${this.calls.length}` }
            queueMicrotask(() => onEvent({ method: 'turn/started', params: { threadId: params.threadId, turn } }))
            return { turn }
          }
          return {}
        },
        write() {}, respond(id, result) { this.answers.push({ id, result }) },
        close() { if (!this.closed) { this.closed = true; onClose() } },
      }
      clients.push(rpc)
      return rpc
    },
  }
  const replyOptions=[]
  const reply = async (text,options) => {output.push(text);replyOptions.push(options);return {status:'accepted'}}
  const complete = async (rpc, text, status = 'completed') => {
    const threadId = rpc.calls.find(c => c.method === 'turn/start').params.threadId
    if (text) await rpc.event({ method: 'item/completed', params: { threadId, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text } } })
    await rpc.event({ method: 'turn/completed', params: { threadId, turn: { status, error: status === 'failed' ? { message: 'test failure' } : null } } })
  }
  let manager = await new SessionManager(options).init()
  try {
    await manager.handle('stranger', '读一下服务器的项目', reply)
    assert.equal(clients.length, 0)
    const exact = '连接 spark，帮我查看项目，保留标点 $(example) `text`'
    await manager.handle('owner', {text:exact,traceId:'known-trace-123'}, reply, 1)
    const first = clients.at(-1)
    assert.equal(first.calls.at(-1).params.input[0].text, exact)
    assert.equal(first.calls.at(-1).params.collaborationMode.settings.developer_instructions,null)
    assert.equal(manager.sessions.get('owner').traceId,'known-trace-123')
    await first.event({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '正在检查项目配置。' } } })
    assert.ok(output.includes('正在检查项目配置。'))
    assert.equal(replyOptions.at(-1).traceId,'known-trace-123')
    const callsBeforeProgress=first.calls.length
    await manager.handle('owner', '进度', reply, 3, undefined, {action:'progress'})
    assert.match(output.at(-1), /正在处理[\s\S]*最近进展：正在检查项目配置。/)
    assert.equal(first.calls.length,callsBeforeProgress)
    assert.equal(manager.sessions.get('owner').queue.length,0)
    manager.sessions.get('owner').lastUpdate = Date.now() - 16_000
    await first.event({ method: 'item/started', params: { threadId: 'thread-1', item: { id: 'cmd', type: 'commandExecution', command: 'secret command' } } })
    assert.ok(!output.includes('Codex 正在执行命令…'))
    assert.ok(!output.some(text => text.includes('secret command')))
    await manager.handle('owner', exact, reply, 1)
    assert.equal(first.calls.filter(c => c.method === 'turn/start').length, 1)
    await manager.handle('owner', { text: '下一条', images: ['/tmp/test.png'] }, reply, 2)
    assert.equal(manager.sessions.get('owner').queue.length, 1)
    await first.event({ id: 8, method: 'item/tool/requestUserInput', params: { threadId: 'thread-1', questions: [{ id: 'which', question: '哪台机器？', header: '机器' }] } })
    assert.match(output.at(-1),/发送“回答”/)
    assert.doesNotMatch(output.at(-1),/\/回答/)
    const code = [...manager.questions.keys()][0]
    await manager.handle('other', 'spark', reply,undefined,undefined,{action:'answer',code,text:'spark'})
    assert.equal(first.answers.length, 0)
    await manager.handle('owner', 'spark', reply,undefined,undefined,{action:'answer',code,text:'spark'})
    assert.deepEqual(first.answers[0], { id: 8, result: { answers: { which: { answers: ['spark'] } } } })
    await complete(first, '第一条回答')
    assert.equal(first.calls.at(-1).params.input[0].text, '下一条')
    assert.deepEqual(first.calls.at(-1).params.input[1], { type: 'localImage', path: '/tmp/test.png' })
    await manager.handle('owner', '进度', reply, 4, undefined, {action:'progress'})
    assert.match(output.at(-1), /尚无新的阶段信息/)
    assert.doesNotMatch(output.at(-1), /正在检查项目配置/)
    await manager.handle('owner', '应清空的队列', reply)
    await manager.handle('owner', '停止', reply)
    assert.equal(first.calls.at(-1).method, 'turn/interrupt')
    assert.equal(manager.sessions.get('owner').queue.length, 0)
    await complete(first, '', 'interrupted')
    await manager.handle('owner', '退出', reply)
    assert.equal(first.closed, true)
    await manager.saving
    manager.close()
    manager = await new SessionManager(options).init()
    await manager.handle('owner', '恢复刚才对话', reply)
    const second = clients.at(-1)
    assert.ok(second.calls.some(c => c.method === 'thread/resume' && c.params.threadId === 'thread-1'))
    await complete(second, '', 'failed')
    assert.ok(output.some(text => text.includes('任务失败：test failure')))
    await manager.handle('owner', '重置会话', reply, undefined, undefined, {action:'new'})
    assert.equal(manager.state.users.owner.threadId, 'thread-2')
    assert.deepEqual(manager.state.users.owner.previous, ['thread-1'])
    await manager.handle('owner', '这个任务应被关闭', reply)
    const third = clients.at(-1)
    await manager.handle('owner', '退出', reply)
    assert.equal(third.calls.at(-1).method, 'turn/interrupt')
    await complete(third, '', 'interrupted')
    assert.equal(manager.sessions.has('owner'), false)
    assert.equal(third.closed, true)
  } finally { manager.close(); await manager.saving; await rm(dir, { recursive: true, force: true }) }
})

test('design advice is saved and delivered without adding a marker',async()=>{
 const output=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']})
 manager.save=async()=>{}
 manager.state.users.owner={}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,requestText:'你觉得我们是否需要单独做一个桌面版？',finals:[],displayFinals:[],items:new Map(),queue:[],rpc:{closed:false,close(){}},reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('owner',session)
 try{
  await manager.event(session,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'建议先验证移动端网页需求。'}}})
  await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
  assert.equal(output[0],'建议先验证移动端网页需求。')
  assert.equal(manager.state.users.owner.lastReply,'建议先验证移动端网页需求。')
 }finally{manager.close()}
})

test('late tool/commentary events cannot follow final output or contaminate the next turn', async () => {
  const output = []
  const manager = new SessionManager({ stateDir: '/unused', cwd: '/unused', owners: ['owner'] })
  manager.save = async () => {}
  manager.state.users.owner = {}
  const session = { userId: 'owner', threadId: 'thread', turnId: 'one', turnReady: true, busy: true,
    finals: [], items: new Map(), queue: [], lastUpdate: 0, reply: async text => output.push(text) }
  const item = (type, text, turnId = session.turnId, phase = 'commentary') => manager.event(session, {
    method: 'item/completed', params: { threadId: 'thread', turnId, item: { id: text, type, text, phase } },
  })
  await manager.event(session, { method: 'item/started', params: { threadId: 'thread', turnId: 'one', item: { id: 'cmd', type: 'commandExecution' } } })
  assert.deepEqual(output, [])
  await item('agentMessage', '实际检查进展')
  await item('agentMessage', '最终结果', 'one', 'final_answer')
  await item('agentMessage', '最终回答后的迟到进展')
  await manager.event(session, { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'one', status: 'completed' } } })
  session.lastUpdate = 0
  await manager.event(session, { method: 'item/started', params: { threadId: 'thread', turnId: 'one', item: { id: 'late', type: 'commandExecution' } } })
  await item('agentMessage', '结束后的迟到进展')
  assert.deepEqual(output, ['实际检查进展', '最终结果'])
  Object.assign(session, { busy: true, turnReady: true, turnId: 'two', finalReceived: false, finals: [] })
  await item('agentMessage', '上一轮的迟到事件', 'one')
  await manager.event(session, { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'one', status: 'completed' } } })
  assert.equal(session.busy, true)
  await item('agentMessage', '第二轮实际进展', 'two')
  assert.deepEqual(output, ['实际检查进展', '最终结果', '第二轮实际进展'])
})

test('queued progress is discarded when final output has already arrived', async () => {
  const output = []
  const manager = new SessionManager({ stateDir: '/unused', cwd: '/unused', owners: ['owner'] })
  manager.save = async () => {}
  manager.state.users.owner = {}
  let release
  const session = { userId: 'owner', threadId: 'thread', turnId: 'one', turnReady: true, busy: true,
    finals: [], items: new Map(), queue: [], lastUpdate: 0, reply: async text => output.push(text),
    delivering: new Promise(resolve => { release = resolve }) }
  const progress = manager.event(session, { method: 'item/completed', params: { threadId: 'thread', turnId: 'one', item: { id: 'p', type: 'agentMessage', phase: 'commentary', text: '等待发送的旧进展' } } })
  await manager.event(session, { method: 'item/completed', params: { threadId: 'thread', turnId: 'one', item: { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '结果已完成' } } })
  const completed = manager.event(session, { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'one', status: 'completed' } } })
  release()
  await Promise.all([progress, completed])
  assert.deepEqual(output, ['结果已完成'])
})

test('delivery failure is diagnosed without raw exception or text and preserves result recovery',async()=>{
 const events=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],log:(event,fields)=>events.push({event,...fields})})
 manager.save=async()=>{};manager.state.users.owner={}
 const session={userId:'owner',threadId:'thread',turnId:'one',turnReady:true,busy:true,finalReceived:true,finals:['持久化最终结果'],items:new Map(),queue:[],reply:async()=>{throw Error('private-token=never-log')}}
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'one',status:'completed'}}})
 assert.equal(session.busy,false);assert.equal(manager.state.users.owner.lastReply,'持久化最终结果');assert.equal(manager.state.users.owner.recovery.delivery,'unknown');assert.equal(manager.state.users.owner.recovery.delivery_error.error_kind,'delivery_exception');assert.ok(events.some(x=>x.event==='delivery.failed'&&x.delivery_state==='unknown'));assert.ok(events.some(x=>x.event==='delivery.state_changed'&&x.delivery_state==='unknown'));assert.ok(!JSON.stringify(events).includes('never-log'));assert.ok(!JSON.stringify(events).includes('持久化最终结果'))
})

test('explicit final rejection persists failed status and safe diagnostics',async()=>{
 const events=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],log:(event,fields)=>events.push({event,...fields})});manager.save=async()=>{};manager.state.users.owner={}
 const rejection=Object.assign(Error('private API response token=secret'),{name:'ApiError',code:'API_ERROR',httpStatus:403,errcode:19002})
 const session={userId:'owner',threadId:'thread',turnId:'one',turnReady:true,busy:true,finalReceived:true,finals:['已保存的最终结果'],items:new Map(),queue:[],reply:async()=>{throw rejection}}
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'one',status:'completed'}}})
 assert.equal(manager.state.users.owner.recovery.delivery,'failed');assert.equal(manager.state.users.owner.recovery.delivery_error.error_kind,'wechat_api');assert.equal(manager.state.users.owner.recovery.delivery_error.http_status,403);assert.equal(manager.state.users.owner.recovery.delivery_error.api_code,19002);assert.equal(manager.state.users.owner.lastReply,'已保存的最终结果')
 const failed=events.find(x=>x.event==='delivery.failed');assert.equal(failed.delivery_state,'failed');assert.equal(failed.http_status,403);assert.ok(!JSON.stringify(events).includes('secret'));assert.ok(!JSON.stringify(events).includes('已保存的最终结果'))
})
test('context rejection stops repeated progress sends but still attempts the final',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={}
 const rejection=Object.assign(Error('private response'),{name:'ApiError',code:'API_ERROR',httpStatus:200,errcode:-2})
 let attempts=0;const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async()=>{attempts++;throw rejection}}
 const item=(id,phase,text)=>({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id,type:'agentMessage',phase,text}}})
 await manager.event(session,item('p1','commentary','第一段进展。'))
 await manager.event(session,item('p2','commentary','第二段进展。'))
 assert.equal(attempts,1);assert.equal(session.contextRejected,true)
 await manager.event(session,item('final','final_answer','最终内容。'))
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 assert.equal(attempts,2);assert.equal(manager.state.users.owner.recovery.delivery,'failed')
})

test('a new message waits until the preceding final reply finishes delivery',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={}
 let release,started=0
 const blocked=new Promise(resolve=>{release=resolve})
 const session={userId:'owner',threadId:'thread',turnId:'one',turnReady:true,busy:true,finalReceived:true,finals:['final-one'],items:new Map(),queue:[],reply:async text=>{if(text==='final-one')await blocked},rpc:{request:async()=>{started++;return {turn:{id:'two'}}}}}
 const completed=manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'one',status:'completed'}}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(session.finishing,true)
 const incoming=manager.send(session,'next-message');assert.equal(started,0);assert.equal(session.queue.length,1)
 release();await Promise.all([incoming,completed]);assert.equal(started,1);assert.equal(session.turnId,'two');assert.equal(session.finishing,false)
})

test('state persistence failure does not suppress final delivery or leave the session stuck finishing',async()=>{
 const events=[],output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],log:(event)=>events.push(event)})
 manager.save=async()=>{throw Object.assign(Error('private-path'),{code:'ENOSPC'})};manager.state.users.owner={}
 const session={userId:'owner',threadId:'thread',turnId:'one',turnReady:true,busy:true,finalReceived:true,finals:['任务结果'],items:new Map(),queue:[],reply:async text=>output.push(text)}
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'one',status:'completed'}}})
 assert.equal(session.finishing,false);assert.equal(session.busy,false);assert.ok(output[0].startsWith('任务结果'));assert.ok(output[0].includes('会话状态保存失败'));assert.ok(events.includes('state.save_failed'));assert.ok(!output[0].includes('private-path'))
})

test('partial answers do not suppress the final answer or intervening tool events',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={};const s={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>output.push(text)}
 for(const [phase,text] of [['partial_answer','中途答案'],['final_answer','真正最终答案']]){await manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:phase,type:'agentMessage',phase,text}}});if(phase==='partial_answer'){assert.ok(!s.finalReceived);await manager.event(s,{method:'item/started',params:{threadId:'thread',turnId:'turn',item:{id:'tool',type:'commandExecution'}}});assert.ok(s.items.has('tool'))}}
 await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(output[0],'中途答案\n\n真正最终答案')
})


test('one durable ingress deduplicates media and text across process restarts and isolates owners',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wechat-ingress-'))
 try{const options={stateDir:dir,cwd:dir,owners:['owner','other']};const first=await new SessionManager(options).init()
 assert.equal(await first.acceptMessage('owner','media-1'),true)
 assert.equal(await first.acceptMessage('owner','media-1'),false)
 assert.equal(await first.acceptMessage('other','media-1'),true)
 assert.equal(await first.acceptMessage('outsider','media-1'),false)
 const restored=await new SessionManager(options).init();assert.equal(await restored.acceptMessage('owner','media-1'),false)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('exit during initialization cannot revive or start the closed session',async()=>{
 let release;const calls=[],output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='initialize'){await new Promise(r=>{release=r});return {}}throw Error('closed connection must not proceed')}})});manager.save=async()=>{}
 const incoming=manager.handle('owner','do work',async t=>output.push(t));await new Promise(r=>setImmediate(r))
 await manager.handle('owner','退出',async t=>output.push(t));release();await incoming
 assert.deepEqual(calls,['initialize']);assert.equal(manager.sessions.has('owner'),false);assert.ok(output.some(t=>t.includes('已结束当前会话')))
})

test('late approval requests after completion or from old turns cannot reopen an interaction',async()=>{
 const replies=[],answers=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']})
 const s={userId:'owner',threadId:'thread',turnId:'current',busy:false,items:new Map(),reply:async t=>replies.push(t),rpc:{respond:(id,result)=>answers.push({id,result})}}
 const message={id:1,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'current',command:'old command'}}
 await manager.event(s,message);s.busy=true;await manager.event(s,{...message,id:2,params:{...message.params,turnId:'old'}})
 assert.equal(manager.questions.size,0);assert.equal(replies.length,0);assert.equal(answers.length,2);assert.ok(answers.every(a=>a.result.decision==='decline'))
})
test('failed dedup persistence does not permanently swallow a retried message',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});let fail=true
 manager.save=async()=>{if(fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'})}
 await assert.rejects(manager.acceptMessage('owner','retry-id'));fail=false
 assert.equal(await manager.acceptMessage('owner','retry-id'),true);assert.equal(await manager.acceptMessage('owner','retry-id'),false)
})

test('late turn/start response cannot overwrite a newer turn',async()=>{
 let release,started;const ready=new Promise(r=>{started=r});const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],remoteControl:async()=>({active:true})});manager.save=async()=>{};manager.state.users.owner={}
 const s={userId:'owner',threadId:'thread',busy:false,queue:[],items:new Map(),rpc:{closed:false,request:async()=>new Promise(r=>{release=r;started()})}}
 const first=manager.send(s,'first');await ready;s.traceId='newer-trace';s.turnId='newer-turn';s.busy=true
 release({turn:{id:'old-turn'}});await first;assert.equal(s.turnId,'newer-turn');assert.equal(s.busy,true)
})
test('state save failure after successful turn start does not kill a running task',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{throw Error('disk full')};manager.state.users.owner={}
 const s={userId:'owner',threadId:'thread',busy:false,queue:[],items:new Map(),reply:async t=>output.push(t),rpc:{closed:false,request:async()=>({turn:{id:'running'}}),close(){throw Error('must not kill task')}}}
 await manager.send(s,'work');assert.equal(s.busy,true);assert.equal(s.turnId,'running');assert.ok(output[0].includes('任务继续执行'))
})
test('reset invalidates connecting session even when closing the process is asynchronous',async()=>{
 let release,count=0;const calls=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>{const n=++count;return {closed:false,write(){},close(){},async request(method){calls.push([n,method]);if(method==='initialize'){if(n===1)await new Promise(r=>{release=r});return {}}if(method==='skills/extraRoots/set'||method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'new-thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};throw Error('unexpected inference')}}}});manager.save=async()=>{}
 const old=manager.handle('owner','old work',async()=>{});await new Promise(r=>setImmediate(r))
 await manager.handle('owner','重置会话',async()=>{},undefined,undefined,{action:'new'});release();await old
 assert.ok(!calls.some(([n,m])=>n===1&&m==='thread/start'));assert.ok(!calls.some(([,m])=>m==='turn/start'));assert.equal(manager.sessions.get('owner').threadId,'new-thread');manager.close()
})
test('all pre-stop connecting messages are cancelled; a later message still starts',async()=>{
 let release;const calls=[];const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='initialize'){await new Promise(r=>{release=r});return {}}if(method==='skills/extraRoots/set'||method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};if(method==='turn/start')return {turn:{id:'fresh'}};throw Error('unexpected')}})});manager.save=async()=>{}
 const first=manager.handle('owner','old one',async()=>{});await new Promise(r=>setImmediate(r));const second=manager.handle('owner','old two',async()=>{})
 await manager.handle('owner','停止',async()=>{});release();await Promise.all([first,second]);assert.ok(!calls.includes('turn/start'))
 await manager.handle('owner','new work',async()=>{});assert.equal(calls.filter(m=>m==='turn/start').length,1);manager.close()
})
test('stop waiting for startup cannot interrupt a newer task',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});const calls=[]
 const s={userId:'owner',traceId:'old',busy:true,turnReady:false,queue:[],rpc:{closed:false,request:async m=>calls.push(m)}}
 const stop=manager.interrupt(s);s.traceId='new';s.turnId='new-turn';s.turnReady=true;await stop;assert.deepEqual(calls,[])
})
test('repeated stop requests share one interruption RPC for the same turn',async()=>{
 let release,calls=0;const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']})
 const s={userId:'owner',traceId:'same',turnId:'turn',busy:true,turnReady:true,queue:[],rpc:{closed:false,request:async()=>{calls++;await new Promise(r=>{release=r})}}}
 const a=manager.interrupt(s),b=manager.interrupt(s);assert.equal(a,b);assert.equal(calls,1);release();await Promise.all([a,b])
})
test('a message captured before stop cannot re-enter after persistence or attachment waiting',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>{throw Error('stale input must not connect')}});manager.save=async()=>{}
 const old=manager.lifecycle.capture('owner');await manager.handle('owner','停止',async()=>{})
 await manager.handle('owner',{text:'late attachment',images:[]},async()=>{},undefined,old);assert.equal(manager.sessions.size,0)
})
test('rejected new conversation does not cancel current work or pending attachments',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{}
 const token=manager.lifecycle.capture('owner');let cancelled=false;manager.lifecycle.onCancel(()=>{cancelled=true})
 manager.sessions.set('owner',{userId:'owner',busy:true,queue:['retained'],rpc:{closed:false}})
 const output=[];await manager.handle('owner','重置会话',async t=>output.push(t),undefined,undefined,{action:'new'});assert.equal(token.current(),true);assert.equal(cancelled,false);assert.deepEqual(manager.sessions.get('owner').queue,['retained']);assert.ok(output[0].includes('停止'))
})

test('deltas are silent and authoritative final text is delivered once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wechat-stream-')),output=[]
 const manager=await new SessionManager({stateDir:dir,cwd:join(dir,'work'),owners:['owner'],remoteControl:async()=>({active:true}),rpcFactory:()=>({closed:false,request:async m=>m==='thread/start'?{thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}:m==='turn/start'?{turn:{id:'turn'}}:{},write(){},close(){this.closed=true}})}).init()
 try{await manager.handle('owner','test',async t=>output.push(t),1);const session=manager.sessions.get('owner'),prefix='这是一段用于验证微信分段发送的文字。'.repeat(8);await manager.event(session,{method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'turn',itemId:'answer',delta:prefix}});assert.equal(output.length,0);await manager.event(session,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:prefix+'最后结果。'}}});await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(output.join(''),prefix+'最后结果。');assert.equal(manager.state.users.owner.lastReply,prefix+'最后结果。')}finally{manager.close();await rm(dir,{recursive:true,force:true})}
})

test('multi-sentence commentary is sent once when its item completes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wechat-stage-')),output=[]
 const manager=await new SessionManager({stateDir:dir,cwd:join(dir,'work'),owners:['owner'],remoteControl:async()=>({active:true}),rpcFactory:()=>({closed:false,request:async m=>m==='thread/start'?{thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}:m==='turn/start'?{turn:{id:'turn'}}:{},write(){},close(){this.closed=true}})}).init()
 try{
  await manager.handle('owner','test',async t=>output.push(t),1)
  const session=manager.sessions.get('owner'),params={threadId:'thread',turnId:'turn',itemId:'stage'}
  await manager.event(session,{method:'item/started',params:{...params,item:{id:'stage',type:'agentMessage',phase:'commentary'}}})
  await manager.event(session,{method:'item/agentMessage/delta',params:{...params,delta:'我正在核对当前任务的'}})
  assert.deepEqual(output,[])
  await manager.event(session,{method:'item/agentMessage/delta',params:{...params,delta:'状态和消息投递链路。后续还要检查测试'}})
  assert.deepEqual(output,[])
  await manager.event(session,{method:'item/completed',params:{...params,item:{id:'stage',type:'agentMessage',phase:'commentary',text:'我正在核对当前任务的状态和消息投递链路。后续还要检查测试。'}}})
  assert.deepEqual(output,['我正在核对当前任务的状态和消息投递链路。后续还要检查测试。'])
  await manager.event(session,{method:'item/completed',params:{...params,item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'检查完成。'}}})
  await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
  assert.deepEqual(output,['我正在核对当前任务的状态和消息投递链路。后续还要检查测试。','检查完成。'])
 }finally{manager.close();await rm(dir,{recursive:true,force:true})}
})

test('completion marker follows final delivery once and never marks an active partial answer complete',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'end-marker-')),output=[],manager=await new SessionManager({stateDir:dir,cwd:join(dir,'work'),owners:['owner'],completionMarkers:true}).init();manager.state.users.owner={}
 const s={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>{output.push(text);return {status:'accepted'}}}
 try{await manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'partial',type:'agentMessage',phase:'partial_answer',text:'仍在处理。'}}});assert.equal(output.length,0);await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.deepEqual(output,['仍在处理。']);await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(output.length,1);assert.equal(manager.state.users.owner.lastReply,'仍在处理。')}finally{manager.close();await rm(dir,{recursive:true,force:true})}
})
test('confirmed routed source turn replaces model completion with one queued status',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],completionMarkers:true})
 manager.save=async()=>{}
 manager.state.users.owner={}
 manager.state.managementOperations=[{id:'route',name:'route_conversation_request',caller:'owner',sourceTaskId:'source-task',status:'queued',data:{taskId:'target-task',name:'知识库'}}]
 manager.submissions={get:()=>({id:'target-task',state:'pending',input:{projectDispatch:{operationId:'route'}}})}
 const s={userId:'owner',taskId:'source-task',threadId:'source-thread',turnId:'source-turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>{output.push(text);return {status:'accepted'}}}
 try{
  await manager.event(s,{method:'item/completed',params:{threadId:'source-thread',turnId:'source-turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'任务已经全部完成。'}}})
  await manager.event(s,{method:'turn/completed',params:{threadId:'source-thread',turn:{id:'source-turn',status:'completed'}}})
  assert.deepEqual(output,['已交给知识库会话，目前排队中；结果将在目标会话返回。'])
  assert.equal(manager.state.users.owner.lastReply,output[0])
  assert.doesNotMatch(output[0],/本轮回答结束|全部完成/)
  manager.state.managementOperations[0].status='unknown'
  const uncertain={...s,turnId:'uncertain-turn',busy:true,finals:[],displayFinals:[],items:new Map()}
  await manager.event(uncertain,{method:'item/completed',params:{threadId:'source-thread',turnId:'uncertain-turn',item:{id:'answer-2',type:'agentMessage',phase:'final_answer',text:'已成功转交。'}}})
  await manager.event(uncertain,{method:'turn/completed',params:{threadId:'source-thread',turn:{id:'uncertain-turn',status:'completed'}}})
  assert.match(output[1],/转交结果尚未确认/)
  assert.doesNotMatch(output[1],/已成功转交|本轮回答结束/)
  manager.state.managementOperations[0].status='queued'
  const failed={...s,turnId:'failed-turn',busy:true,finals:[],displayFinals:[],items:new Map()}
  await manager.event(failed,{method:'turn/completed',params:{threadId:'source-thread',turn:{id:'failed-turn',status:'failed',error:{message:'source error'}}}})
  assert.match(output[2],/排队中；结果将在目标会话返回/)
  assert.match(output[2],/源会话本轮处理失败/)
  assert.doesNotMatch(output[2],/本轮回答结束|任务已经全部完成/)
  const interrupted={...s,turnId:'interrupted-turn',busy:true,finals:[],displayFinals:[],items:new Map()}
  await manager.event(interrupted,{method:'turn/completed',params:{threadId:'source-thread',turn:{id:'interrupted-turn',status:'interrupted'}}})
  assert.match(output[3],/排队中；结果将在目标会话返回/)
  assert.doesNotMatch(output[3],/本轮已停止|本轮回答结束/)
 }finally{manager.close()}
})
test('prepare_failed final stays recoverable without a second failing notice',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],completionMarkers:true})
 manager.save=async()=>{}
 manager.state.users.owner={}
 const calls=[],error=Object.assign(Error('prepare failed'),{name:'ApiError',code:'API_ERROR',httpStatus:200,errcode:-2,payload:{errmsg:'prepare failed'}})
 const s={userId:'owner',taskId:'task',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async value=>{calls.push(value);throw error}}
 try{
  await manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Saved result.'}}})
  await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
  assert.equal(calls.length,1)
  assert.match(manager.state.users.owner.lastReply,/Saved result/)
  assert.equal(manager.state.users.owner.recovery.delivery,'failed')
 }finally{manager.close()}
})
test('idle release waits for an active model turn and only closes the idle Codex session',async()=>{
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']})
 const s={userId:'owner',state:'active',rpc:{closed:false},queue:[],lastUserInputAt:Date.now()-600_001}
 manager.sessions.set('owner',s)
 let releases=0
 manager.releaseConnection=async()=>{releases++}
 try{
  manager.scheduleIdleRelease(s)
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(releases,0)
  assert.equal(manager.sessions.get('owner'),s)
  s.state='idle'
  manager.scheduleIdleRelease(s)
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(releases,1)
  assert.equal(manager.sessions.has('owner'),false)
 }finally{clearTimeout(s.idleReleaseTimer);manager.close()}
})
test('connection close drains a queued completion before declaring the result unknown',async()=>{
 const output=[],events=[],callbacks={}
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],completionMarkers:true,log:event=>events.push(event),rpcFactory:options=>{callbacks.event=options.onEvent;callbacks.close=options.onClose;return {closed:false,close(){this.closed=true}}}})
 manager.save=async()=>{};manager.state.users.owner={recovery:{execution:'running'}}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.attachRpc(session)
 callbacks.event({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'final',type:'agentMessage',phase:'final_answer',text:'最终结果。'}}})
 callbacks.event({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 callbacks.close()
 await session.events
 assert.deepEqual(output,['最终结果。'])
 assert.equal(manager.state.users.owner.recovery.execution,'completed')
 assert.equal(manager.state.users.owner.recovery.delivery,'accepted')
 assert.ok(!events.includes('delivery.suppressed'))
})
test('connection close without completion keeps the task result unknown',async()=>{
 const output=[],callbacks={}
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],completionMarkers:true,rpcFactory:options=>{callbacks.event=options.onEvent;callbacks.close=options.onClose;return {closed:false,close(){this.closed=true}}}})
 manager.save=async()=>{};manager.state.users.owner={recovery:{execution:'running'}}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.attachRpc(session)
 callbacks.event({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'progress',type:'agentMessage',phase:'commentary',text:'正在处理。'}}})
 callbacks.close()
 await session.events
 assert.equal(manager.state.users.owner.recovery.execution,'unknown')
 assert.ok(output.some(text=>text.includes('连接中断，任务结果尚未确认')))
 assert.ok(!output.some(text=>text.includes('本轮回答结束')))
})
test('connection close does not submit queued work after a received completion',async()=>{
 const output=[],calls=[],callbacks={}
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:options=>{callbacks.event=options.onEvent;callbacks.close=options.onClose;return {closed:false,close(){this.closed=true},async request(method){calls.push(method);throw Error('closed RPC must not receive a new turn')}}}})
 manager.save=async()=>{};manager.state.users.owner={recovery:{execution:'running'}}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[{input:'queued work',token:manager.lifecycle.capture('owner')}],reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('owner',session);manager.attachRpc(session)
 callbacks.event({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 callbacks.close()
 await session.events
 assert.deepEqual(calls,[])
 assert.equal(manager.state.users.owner.recovery.execution,'completed')
 assert.equal(session.queue.length,0)
 assert.ok(output.some(text=>text.includes('1 条排队消息尚未提交，请重新发送')))
})
test('delayed close and completion cannot overwrite a replacement session recovery',async()=>{
 let releaseDelivery,deliveryStarted
 const started=new Promise(resolve=>{deliveryStarted=resolve}),blocked=new Promise(resolve=>{releaseDelivery=resolve})
 const callbacks={},output=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:options=>{callbacks.event=options.onEvent;callbacks.close=options.onClose;return {closed:false,close(){this.closed=true}}}})
 manager.save=async()=>{};manager.state.users.owner={recovery:{execution:'running'}}
 const old={userId:'owner',threadId:'thread',turnId:'old-turn',turnReady:true,busy:true,finals:['旧任务结果'],items:new Map(),queue:[],reply:async text=>{output.push(text);deliveryStarted();await blocked;return {status:'accepted'}}}
 manager.sessions.set('owner',old);manager.attachRpc(old)
 callbacks.event({method:'turn/completed',params:{threadId:'thread',turn:{id:'old-turn',status:'completed'}}})
 await started
 callbacks.close()
 const replacement={userId:'owner',threadId:'thread',busy:true},recovery={task:{id:'new-task'},execution:'running',delivery:null}
 manager.sessions.set('owner',replacement);manager.state.users.owner.recovery=recovery
 releaseDelivery()
 await old.events
 assert.equal(manager.state.users.owner.recovery,recovery)
 assert.equal(recovery.execution,'running')
 assert.equal(recovery.delivery,null)
})
test('a stale close callback leaves the replacement task running',async()=>{
 const callbacks={}
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:options=>{callbacks.close=options.onClose;return {closed:false,close(){this.closed=true}}}})
 manager.save=async()=>{};manager.state.users.owner={recovery:{execution:'running'}}
 const old={userId:'owner',threadId:'thread',busy:true,queue:[],reply:async()=>({status:'accepted'})}
 manager.sessions.set('owner',old);manager.attachRpc(old)
 callbacks.close()
 const replacement={userId:'owner',busy:true},recovery={execution:'running',delivery:null}
 manager.sessions.set('owner',replacement);manager.state.users.owner.recovery=recovery
 await old.events
 assert.equal(manager.state.users.owner.recovery,recovery)
 assert.equal(recovery.execution,'running')
})
test('failed delivery gets an uncertainty marker rather than a successful delivery claim',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'end-marker-failed-')),output=[],manager=await new SessionManager({stateDir:dir,cwd:join(dir,'work'),owners:['owner'],completionMarkers:true}).init();manager.state.users.owner={}
 const s={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:['结果'],items:new Map(),queue:[],reply:async text=>{if(text.startsWith('结果'))throw Error('send failed');output.push(text)}}
 try{await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.ok(output[0].includes('未确认送达'));assert.ok(!output.includes('✅ 本轮回答结束。'))}finally{manager.close();await rm(dir,{recursive:true,force:true})}
})

test('waiting attachment preserves logical task and produces only one completion after attachment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attachment-flow-')),out=[];let turns=0
 const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],completionMarkers:true,remoteControl:async()=>({}),rpcFactory:()=>({closed:false,write(){},close(){},async request(method,params){if(method.startsWith('thread/'))return {thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};return {turn:{id:'turn'+(++turns)}}}})}).init()
 try{
 await m.handle('u','总结聊天记录文件',async t=>out.push(t));const s=m.sessions.get('u'),task=s.localTask.id
 await m.event(s,{method:'turn/started',params:{threadId:'t',turn:{id:s.turnId}}})
 await m.event(s,{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',phase:'final_answer',text:`请发送聊天记录文件。<wechat-task:${s.traceId}>waiting_attachment</wechat-task:${s.traceId}>`}}})
 await m.event(s,{method:'turn/completed',params:{threadId:'t',turn:{id:s.turnId,status:'completed'}}})
 assert.equal(m.state.users.u.recovery.execution,'waiting_attachment');assert.equal(m.state.users.u.waitingAttachment.task.id,task);assert.ok(!out.join('').includes('本轮回答结束'));assert.ok(!out.join('').includes('wechat-task'))
 await m.handle('u',{text:'附件说明',attachments:[{path:'/tmp/x.zip'}]},async t=>out.push(t));assert.equal(s.localTask.id,task)
 await m.event(s,{method:'turn/started',params:{threadId:'t',turn:{id:s.turnId}}})
 await m.event(s,{method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',phase:'final_answer',text:'文件总结完成。'}}})
 await m.event(s,{method:'turn/completed',params:{threadId:'t',turn:{id:s.turnId,status:'completed'}}})
 assert.equal(out.filter(t=>t.includes('本轮回答结束')).length,0);assert.equal(m.state.users.u.waitingAttachment,undefined)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('stop and exit each issue one local interrupt',async()=>{
 for(const command of ['停止','退出']){
  const dir=await mkdtemp(join(tmpdir(),'one-interrupt-')),calls=[]
  const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='skills/extraRoots/set'||method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};if(method==='turn/start')return {turn:{id:'turn'}};return {}}})}).init()
  try{
   await m.handle('u','work',async()=>{})
   await m.handle('u',command,async()=>{})
   assert.equal(calls.filter(x=>x==='turn/interrupt').length,1)
  }finally{for(const s of m.sessions.values())clearTimeout(s.exitTimer);m.close();await m.saving;await rm(dir,{recursive:true,force:true})}
 }
})

test('failed interrupt and stop during delivery preserve the final reply', async t=>{
 const dir=await mkdtemp(join(tmpdir(),'stop-final-'))
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],rpcFactory:()=>({
  closed:false,write(){},close(){this.closed=true},async request(method){
   if(method==='thread/start')return {thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
   if(method==='turn/start')return {turn:{id:'turn'}}
   if(method==='turn/interrupt')throw Error('interrupt timed out')
   return {}
  }
 })}).init()
 t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
 const delivered=[]
 const deliveryStarted=Promise.withResolvers(),resume=Promise.withResolvers()
 await manager.handle('u','work',async(text,options)=>{
  if(text==='final'){
   deliveryStarted.resolve()
   await resume.promise
   if(options.current())delivered.push(text)
  }
  return {status:'accepted'}
 })
 const session=manager.sessions.get('u')
 await manager.handle('u','停止',async()=>{})
 assert.equal(session.workToken.current(),true)
 session.finals=['final'];session.displayFinals=['final']
 const completed=manager.event(session,{method:'turn/completed',params:{threadId:'t',turn:{id:'turn',status:'completed'}}})
 await deliveryStarted.promise
 await manager.handle('u','停止',async()=>{})
 resume.resolve()
 await completed
 assert.deepEqual(delivered,['final'])
})

test('quiet turn reports elapsed stage time only while the same turn is active',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']})
 const logs=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u'],log:(event,fields)=>logs.push({event,...fields})})
 const session={userId:'u',threadId:'t',busy:true,items:new Map()}
 manager.sessions.set('u',session)
 await manager.event(session,{method:'turn/started',params:{turn:{id:'turn'}}})
 t.mock.timers.tick(30_000)
 const waits=()=>logs.filter(row=>row.event==='turn.waiting_progress').map(row=>row.duration_ms)
 assert.deepEqual(waits(),[30_000])
 t.mock.timers.tick(20_000)
 await manager.event(session,{method:'item/started',params:{turnId:'turn',item:{id:'cmd',type:'commandExecution'}}})
 t.mock.timers.tick(10_000)
 assert.deepEqual(waits(),[30_000])
 t.mock.timers.tick(20_000)
 assert.deepEqual(waits(),[30_000,30_000])
 session.busy=false
 t.mock.timers.tick(60_000)
 assert.deepEqual(waits(),[30_000,30_000])
})

test('App Server diagnostics report pending input, retry and throttled stream activity without payloads',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const {safeRecord}=await import('../../../src/infrastructure/diagnostics/diagnostic-log.mjs')
 const {formatEvent}=await import('../../../src/tools/debug-logs.mjs')
 const rows=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u'],log:(event,fields)=>rows.push(safeRecord(event,fields))})
 const session={userId:'u',threadId:'t',busy:true,items:new Map()}
 manager.sessions.set('u',session)
 const send=(method,params)=>manager.event(session,{method,params:{threadId:'t',turnId:'a',...params}})
 await send('turn/started',{turn:{id:'a'}})
 const flags=['waitingOnApproval','waitingOnUserInput']
 await send('thread/status/changed',{status:{type:'active',activeFlags:flags}})
 await send('thread/status/changed',{status:{type:'active',activeFlags:flags}})
 assert.deepEqual(session.nativeActiveFlags,flags)
 t.mock.timers.tick(30_000)
 assert(!rows.some(r=>r.event==='turn.waiting_progress'))
 await send('thread/status/changed',{status:{type:'active',activeFlags:[]}})
 await send('error',{willRetry:true,error:{message:'private',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:503}}}})
 await send('error',{willRetry:false,error:{message:'private',codexErrorInfo:'private'}})
 await send('item/agentMessage/delta',{turnId:'old',delta:'private'})
 for(let i=0;i<10;i++)await send('item/agentMessage/delta',{delta:'private'})
 t.mock.timers.tick(15_000)
 await send('item/agentMessage/delta',{delta:'private'})
 await send('item/reasoning/summaryTextDelta',{delta:'private'})
 await send('item/commandExecution/outputDelta',{delta:'private'})
 t.mock.timers.tick(15_000)
 assert(!rows.some(r=>r.event==='turn.waiting_progress'))
 t.mock.timers.tick(15_000)
 assert(rows.some(r=>r.event==='turn.waiting_progress'&&r.duration_ms===30_000))
 const lines=rows.map(r=>formatEvent(JSON.stringify(r))?.slice(10))
 assert.deepEqual(lines.filter(l=>l?.startsWith('Codex 正在等你')),['Codex 正在等你批准操作、回答问题'])
 assert(lines.includes('Codex 已解除等待用户操作的状态'))
 assert(lines.includes('模型连接中断，Codex 正在重试（HTTP 503）'))
 assert(lines.includes('Codex 报告错误（原因未提供），不会自动重试'))
 assert.deepEqual(lines.filter(l=>l?.startsWith('已收到')),['已收到回复片段（本轮累计 1 个）','已收到回复片段（本轮累计 11 个）','已收到分析摘要片段（本轮累计 1 个）','已收到命令输出片段（本轮累计 1 个）'])
 assert(!JSON.stringify(rows).includes('private'))
})

test('a stalled reply does not push partial text and preserves the authoritative final answer',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const output=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u']})
 manager.save=async()=>{}
 manager.state.users.u={}
 const session={userId:'u',threadId:'thread',busy:true,items:new Map(),queue:[],finals:[],
   reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('u',session)
 const send=(method,params)=>manager.event(session,{method,params:{threadId:'thread',turnId:'turn',...params}})
 await send('turn/started',{turn:{id:'turn'}})
 await send('item/agentMessage/delta',{itemId:'a',delta:'已查到'})
 await send('item/agentMessage/delta',{itemId:'a',delta:'两个项目。<wechat-memory:x>private'})
 t.mock.timers.tick(29_999)
 assert.deepEqual(output,[])
 t.mock.timers.tick(1)
 await session.delivering
 t.mock.timers.tick(30_000)
 await session.delivering
 assert.deepEqual(output,[])
 await send('item/completed',{item:{id:'a',type:'agentMessage',phase:'final_answer',text:'已核实有三个项目。'}})
 await send('turn/completed',{turn:{id:'turn',status:'completed'}})
 assert.deepEqual(output,['已核实有三个项目。'])
 assert.equal(manager.state.users.u.lastReply,output[0])
})

test('stream retry diagnostics aggregate per turn and recover only on model output',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const {formatEvent}=await import('../../../src/tools/debug-logs.mjs')
 const rows=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u'],log:(event,fields)=>rows.push({event,...fields,timestamp:new Date()})})
 const session=id=>({threadId:id,turnId:id,userId:'u',turnReady:true,busy:true})
 const a=session('a'), b=session('b')
 const send=(s,method,params)=>manager.event(s,{method,params:{threadId:s.threadId,turnId:s.turnId,...params}})
 const retry=s=>send(s,'error',{willRetry:true,error:{codexErrorInfo:'responseStreamDisconnected'}})
 await retry(a)
 await retry(b)
 await retry(a)
 t.mock.timers.tick(12000)
 await send(a,'item/commandExecution/outputDelta',{delta:'private'})
 await send(a,'item/agentMessage/delta',{turnId:'old',delta:'stale'})
 await send(a,'warning',{message:'Falling back from WebSockets to HTTPS transport. private'})
 assert(!rows.some(r=>r.event==='provider.stream_recovered'))
 await send(a,'item/agentMessage/delta',{delta:'reply'})
 await send(a,'item/agentMessage/delta',{delta:'again'})
 await send(b,'item/reasoning/summaryTextDelta',{delta:'private'})
 const lines=rows.map(r=>formatEvent(JSON.stringify(r))?.slice(10)).filter(Boolean)
 assert.equal(lines.filter(l=>l==='模型连接中断，Codex 正在重试').length,2)
 assert.deepEqual(lines.filter(l=>l.includes('已恢复')),['模型输出已恢复，共重试 2 次（耗时 12.0 秒）','模型输出已恢复，共重试 1 次（耗时 12.0 秒）'])
 assert(lines.includes('Codex 已切换到 HTTP'))
 assert(!JSON.stringify(rows).includes('private'))
})

test('command details stay available on demand without being pushed',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u']})
 const output=[], session={userId:'u',threadId:'t',turnId:'a',busy:true,turnReady:true,items:new Map(),startedAt:Date.now(),reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('u',session)
 const event=(stage,id,fields={})=>manager.event(session,{method:'item/'+stage,params:{threadId:'t',turnId:'a',item:{type:'commandExecution',id,command:'private',commandActions:[{type:'search',query:'private'}],...fields}}})
 await event('started','first')
 await event('completed','first',{exitCode:-1})
 await event('completed','first',{exitCode:-1})
 await event('started','second')
 await event('completed','second',{exitCode:1})
 await event('started','third')
 await event('completed','third',{exitCode:128})
 assert.deepEqual(output,[])
 t.mock.timers.tick(21000)
 await event('started','fourth',{commandActions:[{type:'read',path:'private'}]})
 await event('completed','fourth',{exitCode:0,commandActions:[{type:'read',path:'private'}]})
 assert.deepEqual(output,[])
 assert.match(session.lastProgress.text,/搜索内容、读取文件，已结束 4 条，其中 3 条执行结果需要核对/)
 assert(!session.lastProgress.text.includes('退出码'))
 assert(!session.lastProgress.text.includes('private'))
})

test('tool statistics stay on demand and a long turn gets sparse waiting notices',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const output=[]
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u']})
 const session={userId:'u',threadId:'t',busy:true,items:new Map(),reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('u',session)
 const send=(method,params)=>manager.event(session,{method,params:{threadId:'t',turnId:'a',...params}})
 await send('turn/started',{turn:{id:'a'}})
 await send('turn/plan/updated',{plan:[{step:'检查设置',status:'inProgress'}]})
 await send('turn/diff/updated',{diff:'diff --git a/a b/a\n'})
 await send('item/mcpToolCall/progress',{message:'70% private'})
 await send('item/started',{item:{id:'search-1',type:'webSearch'}})
 await send('item/started',{item:{id:'search-2',type:'webSearch'}})
 assert.deepEqual(output,[])
 assert.equal(session.lastProgress.text,'工具报告进度 70%。')
 t.mock.timers.tick(179_999)
 assert.deepEqual(output,[])
 t.mock.timers.tick(1)
 await new Promise(resolve=>setImmediate(resolve))
 await session.delivering
 assert.deepEqual(output,['暂未确认任务仍在执行，已核对执行连接；结果状态待确认。'])
 t.mock.timers.tick(299_999)
 assert.equal(output.length,1)
 t.mock.timers.tick(1)
 await new Promise(resolve=>setImmediate(resolve))
 await session.delivering
 assert.equal(output.length,2)
 session.busy=false
 t.mock.timers.tick(240_000)
 assert.equal(output.length,2)
})

test('heartbeat checks execution and drops a late check after completion; key updates are immediate and deduplicated',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']})
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['u']})
 const session={userId:'u',threadId:'t',busy:true,items:new Map(),reply:async text=>{output.push(text);return {status:'accepted'}}}
 manager.sessions.set('u',session)
 let checks=0,release
 session.rpc={request:async()=>{checks++;return checks===1?{thread:{id:'t',status:{type:'active'}}}:new Promise(resolve=>{release=resolve})}}
 const send=(method,params)=>manager.event(session,{method,params:{threadId:'t',turnId:'a',...params}})
 await send('turn/started',{turn:{id:'a'}})
 const update={item:{id:'p',type:'agentMessage',phase:'commentary',text:'发现配置不匹配，正在修正。'}}
 await send('item/completed',update);await send('item/completed',update)
 assert.deepEqual(output,['发现配置不匹配，正在修正。'])
 t.mock.timers.tick(180000);await new Promise(resolve=>setImmediate(resolve));await session.delivering
 assert.equal(checks,1);assert.equal(output.at(-1),'任务仍在执行，暂无新的关键进展。')
 t.mock.timers.tick(300000);await new Promise(resolve=>setImmediate(resolve));assert.equal(checks,2)
 session.finalReceived=true;session.busy=false;release({thread:{id:'t',status:{type:'active'}}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(output.length,2)
})
