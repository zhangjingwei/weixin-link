import { mkdir, stat, chmod, appendFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {deliveryError} from '../delivery/delivery-error.mjs'
const identifiers = new Set(['trace_id','thread_id','turn_id','rpc_id','rpc_code','method','status','reason','kind','phase','code','signal','error_type','error_kind','error_code','delivery_state','stage','provider','model','model_provider'])
const numbers = new Set(['seq','source_ms','duration_ms','queue_depth','bytes','chars','parts','part','count','attempt','http_status','api_code','pid','exit_code','dropped'])
const booleans = new Set(['final_attempt'])
export function errorFields(error) {
  const names = new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','AggregateError','ApiError','AuthError','NoContextError','MediaError','TransportError','WeChatBotError'])
  const codes = new Set(['EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOENT','EACCES','ENOSPC','EIO','ABORT_ERR'])
  const detail=deliveryError(error)
  return { error_type: names.has(error?.name) ? error.name : 'Error', ...(codes.has(error?.code) ? { code: error.code } : {}), ...(detail.error_kind!=='delivery_exception'?detail:{}) }
}
export function safeRecord(event, fields = {}) {
  if (!/^[a-z][a-z0-9_.]{0,79}$/.test(event)) throw Error('Invalid diagnostic event')
  const result = { timestamp: new Date().toISOString(), event, level: /failed|error|timeout|invalid/.test(event)?'error':event.includes('ignored')?'debug':'info', pid: process.pid }
  for (const [key,value] of Object.entries(fields)) {
    if (['userId','messageId'].includes(key) && value !== undefined) result[key === 'userId' ? 'user_ref' : 'message_ref'] = createHash('sha256').update(String(value)).digest('hex').slice(0,16)
    else if (identifiers.has(key) && (typeof value === 'string' || typeof value === 'number') && /^[a-zA-Z0-9_./:-]{1,128}$/.test(String(value))) result[key] = value
    else if (numbers.has(key) && typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (booleans.has(key) && typeof value === 'boolean') result[key] = value
  }
  return result
}
/** Bounded, serialized JSONL rotation. Deliberately no message bodies, paths, URLs or raw exceptions. */
export function createDiagnosticLog({ dir, maxBytes = 2 * 1024 * 1024, backups = 5, maxPending = 1000 }) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(backups)||backups<1||backups>20||!Number.isSafeInteger(maxPending)||maxPending<1)throw Error('Invalid diagnostic limits')
  let chain = Promise.resolve(), size, pending = 0, dropped = 0, failures = 0
  const file = join(dir,'events.jsonl')
  async function write(record) {
    if (size === undefined) { await mkdir(dir,{recursive:true,mode:0o700}); await chmod(dir,0o700); try {size=(await stat(file)).size;await chmod(file,0o600)}catch(e){if(e.code!=='ENOENT')throw e;size=0} }
    const line=JSON.stringify(record)+'\n', bytes=Buffer.byteLength(line)
    if(size+bytes>maxBytes){for(let i=backups;i>=1;i--){const source=i===1?file:file+'.'+(i-1),target=file+'.'+i;try{if(i===backups)await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e});await rename(source,target)}catch(e){if(e.code!=='ENOENT')throw e}}size=0}
    await appendFile(file,line,{mode:0o600});size+=bytes
  }
  return {
    log(event,fields={}) {
      const record=safeRecord(event,fields)
      if(pending>=maxPending){dropped++;return Promise.resolve(false)}
      pending++
      chain=chain.then(async()=>{if(dropped){record.dropped=dropped;dropped=0}await write(record);return true}).catch(()=>{size=undefined;failures++;if(failures===1||failures%100===0)console.error('DIAGNOSTIC_LOG_WRITE_FAILED');return false}).finally(()=>{pending--})
      return chain
    },
    flush(){return chain},
    stats(){return {pending,dropped,failures}},
  }
}

/** SDK messages may contain request URLs/tokens. Classify known stages and discard their free text. */
export function createSdkLogger(log) {
  const reason = message => {
    if(typeof message!=='string')return 'unspecified'
    for(const [prefix,stage] of [['Poll error','poll'],['Session expired','session_expired'],['Re-login failed','relogin'],['Handler error','handler'],['notifyStart failed','notify_start'],['notifyStop failed','notify_stop'],['Failed to get typing ticket','typing']])if(message.startsWith(prefix))return stage
    return 'unspecified'
  }
  const logger={debug(){},info(){},warn(message){log('wechat.sdk_warning',{reason:reason(message)})},error(message){log('wechat.sdk_error',{reason:reason(message)})},child(){return logger}}
  return logger
}
