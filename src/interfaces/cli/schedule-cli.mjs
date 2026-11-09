#!/usr/bin/env node
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {accountPaths} from '../../infrastructure/accounts/account-store.mjs'
import {controlRequest} from '../../infrastructure/runtime/runtime-control.mjs'

export async function runScheduleCommand(input = process.stdin, {threadId = process.env.WECHAT_CONVERSATION_ID ?? process.env.CODEX_THREAD_ID, account = process.env.WECHAT_ACCOUNT ?? 'default', home = process.env.HOME} = {}) {
  if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(threadId)) throw Error('SCHEDULE_SESSION_REQUIRED')
  let text = ''
  for await (const chunk of input) {text += chunk; if (Buffer.byteLength(text) > 4096) throw Error('SCHEDULE_INPUT_TOO_LARGE')}
  let request
  try {request = JSON.parse(text)} catch {throw Error('SCHEDULE_INVALID_JSON')}
  if (!request || typeof request !== 'object' || Array.isArray(request) || !['create', 'list', 'cancel'].includes(request.action)) throw Error('SCHEDULE_ARGUMENTS_INVALID')
  return controlRequest(accountPaths(account, home).socket, 'POST', '/schedules', {...request, threadId}, 10000)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runScheduleCommand()))}
  catch (error) {console.error(JSON.stringify({ok: false, error: /^SCHEDULE_[A-Z_]+$/.test(error.message) ? error.message : 'SCHEDULE_REQUEST_FAILED'})); process.exitCode = 1}
}
