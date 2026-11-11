import {ASSISTANT_INSTRUCTIONS} from '../../../src/infrastructure/agents/assistant-policy.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager as ActualSessionManager, controlCommand, codexProviderOptions } from '../../../src/wechat/session-manager.mjs'

// Fake-RPC tests must not inherit live provider settings or contact remote hosts.
class SessionManager extends ActualSessionManager { constructor(options){super({providerEnv:{},remoteControl:async()=>({stop_confirmed:true,tasks:[]}),...options})} }

test('custom provider profile overrides resumed model and disables unsupported search', () => {
  const options=codexProviderOptions({WECHAT_CODEX_BASE_URL:'https://provider.example.com',WECHAT_CODEX_MODEL:'configured-model',WECHAT_CODEX_PROVIDER:'custom',WECHAT_CODEX_API_KEY_ENV:'CUSTOM_API_KEY',WECHAT_CODEX_REASONING_EFFORT:'high',WECHAT_CODEX_WEB_SEARCH:'disabled'})
  assert.deepEqual(options.thread,{model:'configured-model',modelProvider:'custom',reasoningEffort:'high'})
  assert.ok(options.args.includes('web_search="disabled"'))
  assert.ok(options.args.includes('model_provider="custom"'))
  assert.ok(options.args.includes('model_reasoning_effort="high"'))
  assert.throws(()=>codexProviderOptions({WECHAT_CODEX_REASONING_EFFORT:'unsafe value'}))
  assert.deepEqual(codexProviderOptions({}).thread,{})
  assert.throws(()=>codexProviderOptions({WECHAT_CODEX_PROVIDER:'bad/path'}))
})

test('only session controls are intercepted; business requests go to Codex verbatim', () => {
  assert.equal(controlCommand('停止').action, 'stop')
  assert.equal(controlCommand('进度').action, 'progress')
  assert.equal(controlCommand('进度？').action, 'progress')
  assert.equal(controlCommand('命令列表').action,'help')
  assert.deepEqual(controlCommand('批准'),{action:'prompt',target:'approvalChoice',decision:'approve'})
  assert.deepEqual(controlCommand('回答'),{action:'prompt',target:'approvalChoice',decision:'answer'})
  assert.equal(controlCommand('批准 abc123'),null)
  assert.equal(controlCommand('回答 abc123 内容'),null)
  assert.equal(controlCommand('帮我检查项目进度'), null)
  assert.equal(controlCommand('请连接 spark 然后进入项目'), null)
  assert.equal(controlCommand('搜索今天天气和新闻'), null)
  for(const alias of ['/codex stop','/stop','/status','/result','/recover','/models','/help','/exit','/new','/reset','/批准 abc123','/回答 abc123 内容','/balance extra'])assert.equal(controlCommand(alias),null)
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
    assert.equal(manager.sessions.get('owner').traceId,'known-trace-123')
    await first.event({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '正在检查项目配置。' } } })
    assert.ok(output.includes('正在检查项目配置。'))
    assert.equal(replyOptions.at(-1).traceId,'known-trace-123')
    const callsBeforeProgress=first.calls.length
    await manager.handle('owner', '进度', reply, 3)
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
    await manager.handle('owner', '进度', reply, 4)
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
    await manager.handle('owner', '重置会话', reply)
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

test('status and models are explicit controls; commands with other arguments remain user text',()=>{
 assert.equal(controlCommand('状态').action,'status');assert.equal(controlCommand('任务状态'),null)
 for(const input of ['/states','/state','/codex states'])assert.equal(controlCommand(input),null)
 assert.equal(controlCommand('模型').action,'models');assert.equal(controlCommand('/codex models'),null);assert.equal(controlCommand('/models extra'),null)
})
test('models reads actual paginated RPC catalogue without starting a turn or changing model',async()=>{
 const output=[],calls=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={}
 const s={userId:'owner',threadId:'thread',model:'model-a',busy:true,rpc:{closed:false,request:async(method,params)=>{calls.push({method,params});assert.equal(method,'model/list');return params.cursor?{data:[{model:'model-b',hidden:false,inputModalities:['text'],supportedReasoningEfforts:[]}],nextCursor:null}:{data:[{model:'model-a',isDefault:true,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:'next'}}}}
 manager.sessions.set('owner',s);await manager.handle('owner','模型',async text=>output.push(text));assert.equal(calls.length,2);assert.equal(calls[1].params.cursor,'next');assert.ok(output[0].includes('model-a [当前] [默认]'));assert.ok(output[0].includes('model-b'));assert.equal(s.model,'model-a');assert.equal(s.busy,true)
})
test('models failures do not fabricate a catalogue or launch model inference',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={};manager.sessions.set('owner',{userId:'owner',threadId:'thread',rpc:{closed:false,request:async()=>{throw Error('model catalogue unavailable')}}});await manager.handle('owner','模型',async text=>output.push(text));assert.equal(output.length,1);assert.ok(output[0].includes('unavailable'));assert.ok(!output[0].includes('gpt-'))
})
test('stop clears queued instructions during final delivery; status/new reflect finishing state',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={};const s={userId:'owner',threadId:'thread',busy:false,finishing:true,queue:['queued'],rpc:{closed:false,close(){throw Error('must not close during final delivery')}}};manager.sessions.set('owner',s)
 await manager.handle('owner','停止',async text=>output.push(text));assert.equal(s.queue.length,0);assert.ok(output.at(-1).includes('已清空'));await manager.handle('owner','状态',async text=>output.push(text));assert.ok(output.at(-1).includes('正在发送最终回复'));await manager.handle('owner','重置会话',async text=>output.push(text));assert.ok(output.at(-1).includes('仍在发送'))
})
test('partial answers do not suppress the final answer or intervening tool events',async()=>{
 const output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner']});manager.save=async()=>{};manager.state.users.owner={};const s={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async text=>output.push(text)}
 for(const [phase,text] of [['partial_answer','中途答案'],['final_answer','真正最终答案']]){await manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:phase,type:'agentMessage',phase,text}}});if(phase==='partial_answer'){assert.ok(!s.finalReceived);await manager.event(s,{method:'item/started',params:{threadId:'thread',turnId:'turn',item:{id:'tool',type:'commandExecution'}}});assert.ok(s.items.has('tool'))}}
 await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(output[0],'中途答案\n\n真正最终答案')
})

test('stop cancels an intake still connecting; model queries wait for initialization',async()=>{
 let release;const calls=[],output=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='initialize'){await new Promise(resolve=>{release=resolve});return {}}if(method==='thread/memoryMode/set')return {};if(method==='thread/start')return {model:'real-model',thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};if(method==='model/list')return {data:[{model:'real-model'}],nextCursor:null};throw Error('must not start inference')}})});manager.save=async()=>{}
 const first=manager.handle('owner','本条应取消',async t=>output.push(t));await new Promise(resolve=>setImmediate(resolve));const models=manager.handle('owner','模型',async t=>output.push(t));await manager.handle('owner','停止',async t=>output.push(t));assert.deepEqual(calls,['initialize']);release();await Promise.all([first,models]);assert.ok(!calls.includes('turn/start'));assert.ok(calls.includes('model/list'));assert.ok(output.some(t=>t.includes('已取消待启动')));manager.close()
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
 const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>{const n=++count;return {closed:false,write(){},close(){},async request(method){calls.push([n,method]);if(method==='initialize'){if(n===1)await new Promise(r=>{release=r});return {}}if(method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'new-thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};throw Error('unexpected inference')}}}});manager.save=async()=>{}
 const old=manager.handle('owner','old work',async()=>{});await new Promise(r=>setImmediate(r))
 await manager.handle('owner','重置会话',async()=>{});release();await old
 assert.ok(!calls.some(([n,m])=>n===1&&m==='thread/start'));assert.ok(!calls.some(([,m])=>m==='turn/start'));assert.equal(manager.sessions.get('owner').threadId,'new-thread');manager.close()
})
test('all pre-stop connecting messages are cancelled; a later message still starts',async()=>{
 let release;const calls=[];const manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='initialize'){await new Promise(r=>{release=r});return {}}if(method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};if(method==='turn/start')return {turn:{id:'fresh'}};throw Error('unexpected')}})});manager.save=async()=>{}
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
 const output=[];await manager.handle('owner','重置会话',async t=>output.push(t));assert.equal(token.current(),true);assert.equal(cancelled,false);assert.deepEqual(manager.sessions.get('owner').queue,['retained']);assert.ok(output[0].includes('停止'))
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
 try{await manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'partial',type:'agentMessage',phase:'partial_answer',text:'仍在处理。'}}});assert.equal(output.length,0);await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.deepEqual(output,['仍在处理。\n\n✅ 本轮回答结束。']);await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(output.length,1);assert.equal(manager.state.users.owner.lastReply,'仍在处理。\n\n✅ 本轮回答结束。')}finally{manager.close();await rm(dir,{recursive:true,force:true})}
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
 assert.deepEqual(output,['最终结果。\n\n✅ 本轮回答结束。'])
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
 assert.equal(out.filter(t=>t.includes('本轮回答结束')).length,1);assert.equal(m.state.users.u.waitingAttachment,undefined)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('stop and exit each issue one local interrupt',async()=>{
 for(const command of ['停止','退出']){
  const dir=await mkdtemp(join(tmpdir(),'one-interrupt-')),calls=[]
  const m=await new SessionManager({stateDir:dir,cwd:dir,owners:['u'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){calls.push(method);if(method==='thread/memoryMode/set')return {};if(method==='thread/start')return {thread:{id:'t'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};if(method==='turn/start')return {turn:{id:'turn'}};return {}}})}).init()
  try{
   await m.handle('u','work',async()=>{})
   await m.handle('u',command,async()=>{})
   assert.equal(calls.filter(x=>x==='turn/interrupt').length,1)
  }finally{for(const s of m.sessions.values())clearTimeout(s.exitTimer);m.close();await m.saving;await rm(dir,{recursive:true,force:true})}
 }
})
