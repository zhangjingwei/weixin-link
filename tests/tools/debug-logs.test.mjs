import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, appendFile, rename, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLogReader, formatEvent} from '../../src/tools/debug-logs.mjs'

const record = (event, fields = {}) => JSON.stringify({timestamp:'2026-01-01T00:00:00Z', event, ...fields})

test('显示阶段、耗时和不确定的投递结果，过滤正文和轮询', () => {
  assert.match(formatEvent(record('turn.completed', {status:'completed', duration_ms:1234, text:'private'})), /^\d\d:\d\d:\d\d  本轮处理完成（耗时 1.2 秒）$/)
  assert.match(formatEvent(record('delivery.failed', {status:'unknown'})), /结果待确认$/)
  assert.match(formatEvent(record('delivery.failed', {status:'failed',delivery_state:'failed',api_reason:'prepare_failed'})), /微信接口拒绝发送（消息准备失败），结果已保留$/)
  assert.match(formatEvent(record('session.idle_released')), /已释放空闲的 Codex 连接.*微信收件仍在运行/)
  assert.equal(formatEvent(record('poll.started')), undefined)
  assert.equal(formatEvent('broken'), undefined)
})

test('跳过历史，读取完整的新行，日志轮换后继续', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-log-test-'))
  t.after(() => rm(dir, {recursive:true, force:true}))
  const file = join(dir, 'events.jsonl'), lines = []
  const read = createLogReader(file, line => lines.push(line))
  await writeFile(file, record('turn.started') + '\n')
  await read()
  await appendFile(file, record('message.received'))
  await read()
  assert.deepEqual(lines, [])
  await appendFile(file, '\n')
  await read()
  await rename(file, file + '.1')
  await read()
  await writeFile(file, record('outbound.text_accepted') + '\n')
  await read()
  await read()
  assert.deepEqual(lines.map(line => line.slice(10)), ['开始处理微信消息', '微信接口已接受文字发送请求'])
})

test('重启展示进程启动、登录和实际就绪，不把初始化保留为最后阶段',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'weixin-start-log-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'events.jsonl'),lines=[]
 const read=createLogReader(file,line=>lines.push(line.slice(10)))
 await writeFile(file,record('service.stopped')+'\n')
 await read()
 await appendFile(file,['service.stopping','service.stopped','service.started','wechat.login_completed','service.ready'].map(event=>record(event)).join('\n')+'\n')
 await read()
 assert.deepEqual(lines,[
  '微信后台服务正在停止','微信后台服务已停止','微信服务进程已启动，正在初始化',
  '微信登录完成，正在启动收件','微信服务已就绪，可以接收消息',
 ])
 assert.equal(formatEvent(record('wechat.login_url_ready')).slice(10),'等待微信扫码登录，服务尚未就绪')
 assert.equal(formatEvent(record('wechat.login_url_invalid')).slice(10),'微信登录链接无效，服务尚未就绪')
 assert.equal(formatEvent(record('wechat.qr_scanned')).slice(10),'微信已扫码，正在确认登录')
 assert.equal(formatEvent(record('service.started')).slice(10),'微信服务进程已启动，正在初始化')
})

test('工具、交互和查询显示可读细节，只展示允许的元数据', () => {
  for (const [event, fields, expected] of [
    ['turn.started', {model:'gpt-test'}, '模型开始处理（gpt-test）'],
    ['turn.started', {}, '模型开始处理'],
    ['turn.waiting_progress', {duration_ms:30000}, '距上次阶段更新已过 30 秒，正在等智能体返回下一步'],
    ['turn.progress', {method:'item/mcpToolCall/progress'}, 'MCP 工具报告了新进度'],
    ['tool.completed', {kind:'commandExecution', exit_code:0, duration_ms:1200}, '模型执行的命令已完成（退出码 0）（耗时 1.2 秒）'],
    ['turn.started', {model:'invalid\nname'}, '模型开始处理'],
    ['tool.started', {kind:'reasoning'}, '模型正在分析'],
    ['tool.started', {kind:'agentMessage'}, '模型正在生成回复'],
    ['tool.completed', {kind:'commandExecution', exit_code:0}, '模型执行的命令已完成（退出码 0）'],
    ['tool.completed', {kind:'commandExecution', exit_code:2}, '模型执行的命令未成功（退出码 2）'],
    ['tool.completed', {kind:'mcpToolCall', status:'failed'}, 'MCP 工具调用未成功'],
    ['interaction.requested', {method:'item/fileChange/requestApproval'}, '等待你批准文件修改'],
    ['rpc.response', {method:'project/list', status:'ok', duration_ms:1200}, '查询 Codex 项目列表结束（耗时 1.2 秒）'],
  ]) {
    assert.equal(formatEvent(record(event, {...fields, text:'private', command:'private'})).slice(10), expected)
  }
  assert.equal(formatEvent(record('tool.started', {kind:'private'})), undefined)
  assert.equal(formatEvent(record('tool.started', {kind:'userMessage'})), undefined)
})

test('会话分页只显示开始和结束，保留中途失败',()=>{
 const page=(event,fields)=>formatEvent(record(event,{method:'thread/list',...fields}))?.slice(10)
 assert.equal(page('rpc.request',{}),'正在查询 Codex 会话列表')
 assert.equal(page('rpc.response',{more_pages:true,status:'ok'}),undefined)
 assert.equal(page('rpc.request',{continuation_page:true}),undefined)
 assert.equal(page('rpc.response',{continuation_page:true,status:'ok',duration_ms:10}),'查询 Codex 会话列表结束')
 assert.equal(page('rpc.response',{continuation_page:true,status:'error'}),'查询 Codex 会话列表失败')
})

test('WorkBuddy typed events show engine and tools; wait state never masquerades as Codex or exposes payload',()=>{
 for(const event of ['provider.connected','session.connected','turn.started'])assert.match(formatEvent(record(event,{agent_kind:'workbuddy',model:'hy4std'})),/WorkBuddy/)
 assert.match(formatEvent(record('tool.started',{kind:'workbuddyTool',text:'secret',command:'private'})),/WorkBuddy 正在调用工具$/)
 assert.match(formatEvent(record('tool.completed',{kind:'workbuddyTool',status:'failed'})),/WorkBuddy 工具调用未成功$/)
 const wait=formatEvent(record('session.wait_changed',{agent_kind:'workbuddy',waiting_approval:true}))
 assert.match(wait,/WorkBuddy 正在等你批准操作$/);assert.doesNotMatch(wait,/Codex|secret/)
 assert.match(formatEvent(record('session.wait_changed',{agent_kind:'workbuddy',waiting_approval:false})),/WorkBuddy 已解除等待/)
})
