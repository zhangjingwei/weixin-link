import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {ConfigError, parseConfig} from '../infrastructure/config/config-schema.mjs'
import {atomicConfigWrite, readPrivateFile, digest} from '../infrastructure/config/config-files.mjs'
import {integrations, integrationById} from './registry.mjs'

function context(options = {}) {
  const home = options.home ?? (process.env.HOME || homedir())
  const account = options.account ?? process.env.WECHAT_ACCOUNT ?? 'default'
  return {home, account, workspace: options.workspace, env: options.env ?? process.env, stateDir: options.stateDir ?? accountPaths(account, home).stateDir}
}
function definition(id) {
  const item = integrationById(id)
  if (!item) throw new ConfigError('INTEGRATION_UNKNOWN')
  return item
}
async function policy(options) {
  const path = join(context(options).stateDir, 'integrations.json')
  const text = await readPrivateFile(path)
  let value = {version: 1, enabled: {}}
  if (text !== null) {
    try { value = JSON.parse(text) } catch { throw new ConfigError('INTEGRATION_POLICY_INVALID') }
    if (!value || value.version !== 1 || !value.enabled || typeof value.enabled !== 'object' || Array.isArray(value.enabled) ||
        Object.keys(value).some(key => !['version', 'enabled'].includes(key)) ||
        Object.entries(value.enabled).some(([id, enabled]) => !integrationById(id) || typeof enabled !== 'boolean')) {
      throw new ConfigError('INTEGRATION_POLICY_INVALID')
    }
  }
  return {path, text, value}
}
async function configuration(item, options) {
  const text = await readPrivateFile(await item.configPath(context(options)))
  if (text === null) throw new ConfigError('INTEGRATION_CONFIG_REQUIRED')
  return parseConfig(item.manifest.configKind, text)
}
async function enabledDefinition(id, options) {
  const item = definition(id)
  if ((await policy(options)).value.enabled[id] !== true) throw new ConfigError('INTEGRATION_DISABLED')
  return item
}
export async function setIntegrationEnabled(id, enabled, options = {}) {
  const item = definition(id)
  if (typeof enabled !== 'boolean') throw new ConfigError('INTEGRATION_ARGUMENTS_INVALID')
  const {path, text, value} = await policy(options)
  if (enabled) {
    const config = await configuration(item, options)
    try { await item.health(config, context(options)) } catch { throw new ConfigError('INTEGRATION_HEALTH_FAILED') }
  }
  value.enabled[id] = enabled
  const result = await atomicConfigWrite(path, JSON.stringify(value, null, 2) + '\n', {expected: digest(text)})
  return {id, enabled, ...result, effective: 'next_operation', guidance: 'next_session_connection'}
}
export async function checkIntegration(id, options = {}) {
  const item = await enabledDefinition(id, options)
  const config = await configuration(item, options)
  try { await item.health(config, context(options)); return {id, ok: true} } catch { throw new ConfigError('INTEGRATION_HEALTH_FAILED') }
}
export async function invokeIntegration(id, request, options = {}) {
  const item = await enabledDefinition(id, options)
  // Re-read both policy and credentials on every call; disabling does not require restarting the bot.
  const config = await configuration(item, options)
  try { return await item.invoke(config, request, {...context(options), scope: options.scope ?? process.env.CODEX_THREAD_ID}) } catch (error) {
    const safe = ['INTEGRATION_OPERATION_NOT_ALLOWED', 'INTEGRATION_ARGUMENTS_INVALID',
      'REMOTE_RESULT_UNCERTAIN', 'REMOTE_OUTPUT_TOO_LARGE', 'REMOTE_FILE_EXISTS',
      'REMOTE_PROJECT_UNAVAILABLE', 'REMOTE_FILE_UNAVAILABLE', 'REMOTE_INPUT_TOO_LARGE']
    throw new ConfigError(safe.includes(error.message) ? error.message : 'INTEGRATION_CALL_FAILED')
  }
}
export async function integrationStatus(options = {}) {
  let enabled
  try { enabled = (await policy(options)).value.enabled } catch {
    return integrations.map(({manifest}) => ({...manifest, enabled: false, error: 'INTEGRATION_POLICY_INVALID'}))
  }
  return Promise.all(integrations.map(async item => {
    const result = {...item.manifest, enabled: enabled[item.manifest.id] === true}
    // Disabled integrations do not read credentials or make any network request.
    if (!result.enabled) return result
    try { await configuration(item, options); return {...result, configured: true, valid: true} }
    catch (error) { return {...result, valid: false, error: error instanceof ConfigError ? error.code : 'INTEGRATION_CONFIG_UNREADABLE'} }
  }))
}
export async function integrationGuidance(options = {}) {
  const blocks = []
  for (const item of await integrationStatus(options)) {
    if (!item.enabled || !item.valid) continue
    try {
      const entry = definition(item.id)
      const source = fileURLToPath(new URL('../../', import.meta.url))
      blocks.push(`## ${item.name}\n集成源码目录：${JSON.stringify(source)}\n` + await readFile(entry.guidanceUrl, 'utf8'))
    } catch { /* An optional integration must not prevent ordinary local conversations. */ }
  }
  return blocks.join('\n\n')
}
