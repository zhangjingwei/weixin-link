import {open} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'

const stages = new Map(Object.entries({
  'session.idle_released': '当前会话无运行中的模型任务，已释放空闲的 Codex 连接（距上次输入满 10 分钟；微信收件仍在运行）',
  'service.stopping': '微信后台服务正在停止',
  'service.stopped': '微信后台服务已停止',
  'service.started': '微信服务进程已启动，正在初始化',
  'wechat.login_url_ready': '等待微信扫码登录，服务尚未就绪',
  'wechat.qr_scanned': '微信已扫码，正在确认登录',
  'wechat.login_url_invalid': '微信登录链接无效，服务尚未就绪',
  'wechat.login_completed': '微信登录完成，正在启动收件',
  'service.ready': '微信服务已就绪，可以接收消息',
  'ingress.persisted': '收到微信消息，已保存',
  'message.received': '开始处理微信消息',
  'message.rejected': '此微信用户没有使用权限',
  'message.cancelled': '已取消处理',
  'message.dispatch_failed': '处理微信消息失败',
  'ingress.persist_failed': '保存微信消息失败',
  'attachments.preprocess_started': '开始读取附件',
  'attachments.preprocess_completed': '附件已准备好',
  'agent.readiness_check': '正在检查模型服务是否可用',
  'queue.waiting_session': '当前项目还有任务在处理，正在排队',
  'queue.starting': '已取出任务，正在准备项目会话',
  'provider.http_fallback': 'Codex 已切换到 HTTP',
  'provider.connected': '模型服务已连接',
  'session.connect_failed': '连接 Codex 会话失败，任务尚未提交',
  'session.connected': '项目会话已连接',
  'turn.queued': '消息已进入会话队列',
  'turn.requested': '正在准备本轮模型输入',
  'session.writer_busy': '另一个 Codex 客户端占用会话，本条消息尚未提交',
  'model.rerouted': '本轮已切换模型',
  'turn.started': '模型开始处理',
  'outbound.text_accepted': '微信接口已接受文字发送请求',
  'outbound.media_accepted': '微信接口已接受附件发送请求',
  'rpc.timeout': '等待模型服务响应超时',
  'wechat.sdk_error': '微信连接或消息处理出错',
}))
const streamLabels=new Map([['reply','回复'],['reasoningSummary','分析摘要'],['commandOutput','命令输出']])
const activities = new Map(Object.entries({
  reasoning: ['模型正在分析', '模型分析阶段结束'],
  plan: ['模型正在整理计划', '计划已生成'],
  agentMessage: ['模型正在生成回复'],
  commandExecution: ['模型正在执行命令', '模型执行的命令'],
  fileChange: ['正在修改文件', '文件修改'],
  mcpToolCall: ['正在调用 MCP 工具', 'MCP 工具调用'],
  dynamicToolCall: ['正在调用外部工具', '外部工具调用'],
  webSearch: ['正在搜索网页', '网页搜索'],
  imageGeneration: ['正在生成图片', '图片生成'],
  collabAgentToolCall: ['正在调用协作智能体', '协作智能体调用'],
}))
const interactions = new Map(Object.entries({
  'item/commandExecution/requestApproval': '等待你批准执行命令',
  'item/fileChange/requestApproval': '等待你批准文件修改',
  'item/permissions/requestApproval': '等待你确认权限请求',
  'item/tool/requestUserInput': '等待你回答模型的问题',
}))
const catalogRequests = new Map(Object.entries({
  'project/list': '查询 Codex 项目列表',
  'project/read': '读取 Codex 项目',
  'project/create': '创建 Codex 项目',
  'thread/list': '查询 Codex 会话列表',
  'thread/search': '搜索 Codex 会话',
  'thread/searchOccurrences': '搜索会话内的消息',
  'thread/read': '读取 Codex 会话',
}))

function activityLabel(row) {
  const activity = activities.get(row.kind)
  if (!activity) return
  if (row.event === 'tool.started') return activity[0]
  if (!activity[1]) return
  if (row.kind === 'reasoning' || row.kind === 'plan') return activity[1]
  if (['cancelled', 'canceled', 'interrupted'].includes(row.status)) return activity[1] + '已中断'
  if (row.kind === 'commandExecution' && Number.isSafeInteger(row.exit_code)) {
    return activity[1] + (row.exit_code === 0 ? '已完成' : '未成功') + '（退出码 ' + row.exit_code + '）'
  }
  if (['failed', 'error', 'declined'].includes(row.status)) return activity[1] + '未成功'
  return activity[1] + '结束'
}

const deliveries = new Map(Object.entries({
  accepted: '微信接口已接受发送请求',
  deferred: '回复已推迟发送',
  partial: '部分内容已提交，剩余部分未确认',
  unknown: '已尝试发送，结果待确认',
  cancelled: '发送已取消',
  failed: '发送失败',
}))

export function formatEvent(line) {
  let row
  try { row = JSON.parse(line) } catch { return }
  if (!row || typeof row !== 'object') return
  let label = stages.get(row.event)
  if (row.event === 'outbound.attachment_prepare_failed') {
    const reason=({UNSUPPORTED_FILE:'不支持该文件格式',FILE_NOT_FOUND:'未找到文件',EXPORT_PATH_REFUSED:'文件路径不允许导出'})[row.reason]
    label='附件准备失败，尚未发送'+(typeof reason==='string'?'（'+reason+'）':'')
  }
  if (row.event === 'tool.started' || row.event === 'tool.completed') label = activityLabel(row)
  if (['turn.started','model.rerouted'].includes(row.event) && typeof row.model === 'string' && /^[a-zA-Z0-9_./:-]{1,128}$/.test(row.model)) {
    label += '（' + row.model + '）'
  }
  if (row.event === 'turn.started' && row.model_provider==='weixin-subscription-http')label+=' · HTTP 流式连接'
  if (row.event === 'turn.waiting_progress' && Number.isFinite(row.duration_ms) && row.duration_ms >= 0) {
    label = `距上次阶段更新已过 ${Math.floor(row.duration_ms / 1000)} 秒，正在等 Codex 返回下一步`
  }
  if (row.event === 'session.wait_changed') {
    const waits=[row.waiting_approval && '批准操作',row.waiting_input && '回答问题'].filter(Boolean)
    label=waits.length?'Codex 正在等你'+waits.join('、'):'Codex 已解除等待用户操作的状态'
  }
  if (row.event === 'provider.event_error') {
    const reason=/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(row.reason??'')?row.reason:'原因未提供'
    const retry=row.will_retry===true?'将自动重试':row.will_retry===false?'不会自动重试':'重试状态未知'
    if(row.attempt>1)return
    if(row.attempt===1)label='模型连接中断，Codex 正在重试'+(Number.isInteger(row.http_status)?`（HTTP ${row.http_status}）`:'')
    else label=`Codex 报告错误（${reason}${Number.isInteger(row.http_status)?'，HTTP '+row.http_status:''}），${retry}`
  }
  if (row.event === 'provider.stream_recovered' && Number.isSafeInteger(row.count))label=`模型输出已恢复，共重试 ${row.count} 次`
  if (row.event === 'turn.stream_progress') {
    const stream=streamLabels.get(row.kind)
    if(stream && Number.isSafeInteger(row.count))label=`已收到${stream}片段（本轮累计 ${row.count} 个）`
  }
  if (row.event === 'turn.progress') label = ({
    'turn/plan/updated':'模型更新了执行计划',
    'turn/diff/updated':'已收到文件变更进度',
    'item/mcpToolCall/progress':'MCP 工具报告了新进度',
  })[row.method]
  if (row.event === 'interaction.requested') label = interactions.get(row.method)
  if (row.method === 'thread/list') {
    if (row.event === 'rpc.request' && row.continuation_page) return
    if (row.event === 'rpc.response' && row.status === 'ok' && row.more_pages) return
  }
  const operation = catalogRequests.get(row.method)
  if (operation && row.event === 'rpc.request') label = '正在' + operation
  if (operation && row.event === 'rpc.response') label = operation + (row.status === 'error' ? '失败' : '结束')
  if (row.event === 'agent.readiness_checked') label = row.status === 'ready' ? '模型服务可用' : '模型服务暂不可用'
  if (row.event === 'rpc.request' && row.method === 'turn/start') label = '正在向模型提交请求'
  if (row.event === 'delivery.completed' || row.event === 'delivery.failed') {
    label = deliveries.get(row.delivery_state ?? row.status) ?? '发送结果待确认'
    if(row.event==='delivery.failed'&&row.delivery_state==='failed'&&row.api_reason==='prepare_failed')label='微信接口拒绝发送（消息准备失败），结果已保留'
    // Individual accepted parts already have their own event.
    if (row.event === 'delivery.completed' && row.status === 'accepted') return
  }
  if (row.event === 'turn.completed') {
    label = ({completed: '本轮处理完成', failed: '本轮处理失败', interrupted: '本轮处理中断'})[row.status]
    if (typeof label !== 'string') label = '本轮处理已结束'
  }
  if (!label) return
  const time = new Date(row.timestamp)
  if (!Number.isFinite(time.getTime())) return
  const duration = row.event !== 'turn.waiting_progress' && !row.continuation_page && Number.isFinite(row.duration_ms) && row.duration_ms >= 0
    ? `（耗时 ${(row.duration_ms / 1000).toFixed(1)} 秒）` : ''
  return `${time.toTimeString().slice(0, 8)}  ${label}${duration}`
}

// Keep only complete lines from the same file across reads and rotations.
export function createLogReader(path, write) {
  let initialized = false, identity, offset = 0, pending = Buffer.alloc(0)
  return async function readNewEvents() {
    let file
    try {
      file = await open(path, 'r')
      const {dev, ino, size} = await file.stat()
      const current = `${dev}/${ino}`
      if (current !== identity || size < offset) {
        offset = initialized ? 0 : size
        identity = current
        pending = Buffer.alloc(0)
      }
      const chunk = Buffer.alloc(65536)
      while (offset < size) {
        const {bytesRead} = await file.read(chunk, 0, Math.min(chunk.length, size - offset), offset)
        if (!bytesRead) break
        offset += bytesRead
        const data = Buffer.concat([pending, chunk.subarray(0, bytesRead)])
        let start = 0, end
        while ((end = data.indexOf(10, start)) !== -1) {
          const line = formatEvent(data.toString('utf8', start, end))
          if (line) write(line)
          start = end + 1
        }
        pending = data.length - start <= chunk.length ? data.subarray(start) : Buffer.alloc(0)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    } finally {
      initialized = true
      await file?.close()
    }
  }
}

if (import.meta.main) {
  const read = createLogReader(join(accountPaths().stateDir, 'logs', 'events.jsonl'), console.log)
  try {
    await read()
    console.log('正在查看新日志。现在可以在微信发一条消息，按 Ctrl+C 结束查看。')
    for (;;) { await sleep(400); await read() }
  } catch {
    console.error('无法读取调试日志，请检查运行目录的读取权限。')
    process.exitCode = 1
  }
}
