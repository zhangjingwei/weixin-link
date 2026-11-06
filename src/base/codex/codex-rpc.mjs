import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {installConfig} from '../../setup/install-config.mjs'
import {errorFields} from '../../core/diagnostic-log.mjs'
import {codexProviderOptions} from './provider-options.mjs'

function rpcFailure(message,fields={}) {
  const error=new Error(message)
  Object.assign(error,fields)
  return error
}

export class CodexRpc {
  constructor({ cwd, onEvent, onClose, log = () => {}, binary = installConfig().codexBinary, provider = 'configured', providerOptions: resolvedProviderOptions }) {
    this.log = log
    this.provider = provider
    this.nextId = 0
    this.pending = new Map()
    this.closed = false
    const env = { ...process.env, TZ: 'Asia/Shanghai' }
    for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'CODEX_API_KEY', 'HA_TOKEN', 'HA_BASE_URL']) delete env[key]
    const selectedOptions=resolvedProviderOptions ?? codexProviderOptions(env)
    this.providerOptions=selectedOptions
    this.child = spawn(binary, selectedOptions.args, { cwd, env })
    this.child.stdin.on('error', () => {})
    this.child.stderr.on('data', chunk => { this.stderrBytes = (this.stderrBytes ?? 0) + chunk.length })
    this.log('rpc.spawn', { pid: this.child.pid })
    createInterface({ input: this.child.stdout }).on('line', line => {
      let msg
      try { msg = JSON.parse(line) } catch { this.log('rpc.invalid_json'); return }
      if (msg.id !== undefined && !msg.method) {
        const request = this.pending.get(msg.id)
        if (!request) { this.log('rpc.unmatched_response', {rpc_id: msg.id}); return }
        this.pending.delete(msg.id)
        clearTimeout(request.timer)
        this.log('rpc.response', {rpc_id:msg.id,method:request.method,status:msg.error?'error':'ok',code:msg.error?.code,duration_ms:Date.now()-request.started})
        if (msg.error) request.reject(rpcFailure(msg.error.message ?? 'Codex 请求失败。',{definitiveRpcError:true,rpcCode:msg.error.code,method:request.method}))
        else request.resolve(msg.result)
      } else Promise.resolve(onEvent(msg)).catch(error => this.log('rpc.event_failed', errorFields(error)))
    })
    const close = (code, signal) => {
      this.log('rpc.closed', {exit_code:typeof code==='number'?code:undefined,signal,bytes:this.stderrBytes??0})
      if (this.closed) return
      this.closed = true
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(rpcFailure('Codex 连接已断开。',{connectionClosed:true,method:request.method}))
      }
      this.pending.clear()
      onClose()
    }
    this.child.on('error', error => {this.log('rpc.spawn_failed',errorFields(error));close()})
    this.child.on('close', close)
  }
  write(message) {
    if (this.closed) throw rpcFailure('Codex 连接已关闭。',{connectionClosed:true})
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }
  request(method, params, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const started=Date.now()
      this.log('rpc.request',{rpc_id:id,method})
      const timer = setTimeout(() => { this.log('rpc.timeout',{rpc_id:id,method,duration_ms:Date.now()-started}); this.pending.delete(id); reject(rpcFailure(`Codex ${method} 响应超时。`,{requestTimeout:true,method})) }, timeout)
      this.pending.set(id, { resolve, reject, timer, method, started })
      try { this.write({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error?error:rpcFailure(String(error),{connectionClosed:true,method})) }
    })
  }
  respond(id, result) { this.write({ id, result }) }
  close() { this.child.kill() }
}
