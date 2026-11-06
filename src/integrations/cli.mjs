#!/usr/bin/env node
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readConfigStdin} from '../setup/config-manager.mjs'
import {integrationStatus, setIntegrationEnabled, checkIntegration, invokeIntegration} from './runtime.mjs'

export async function runIntegrationCommand(action, args = [], input = process.stdin) {
  if (action === 'list' || action === 'status') {
    if (args.length > 1) throw Error('INTEGRATION_ARGUMENTS_INVALID')
    return integrationStatus({account: args[0]})
  }
  if (!['enable', 'disable', 'check', 'call'].includes(action) || args.length < 1 || args.length > 2) throw Error('INTEGRATION_ARGUMENTS_INVALID')
  const [id, account] = args, options = {account}
  if (action === 'enable' || action === 'disable') return setIntegrationEnabled(id, action === 'enable', options)
  if (action === 'check') return checkIntegration(id, options)
  return invokeIntegration(id, await readConfigStdin(input), options)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runIntegrationCommand(process.argv[2], process.argv.slice(3)))) }
  catch (error) {
    const code = /^(?:CONFIG|INTEGRATION)_[A-Z_]+$/.test(error.message) ? error.message : 'INTEGRATION_FAILED'
    console.error(JSON.stringify({ok: false, error: code})); process.exitCode = 1
  }
}
