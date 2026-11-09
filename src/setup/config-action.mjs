import {configStatus,configure,readConfigStdin,restoreConfiguration} from './config-manager.mjs'
import {configSchema,validateConfig} from './config-schema.mjs'

/** Structured management CLI entry for configuration. */
export async function runConfigurationAction(action, args = [], input = process.stdin) {
  if (action === 'config-status') {
    if (args.length) throw Error('CONFIG_ARGUMENTS_INVALID')
    return configStatus()
  }
  if (!['config-schema', 'config-check', 'config-set', 'config-restore'].includes(action) || args.length !== 1) throw Error('CONFIG_ARGUMENTS_INVALID')
  const kind = args[0]
  if (action === 'config-schema') return configSchema(kind)
  if (action === 'config-check') {
    const config = validateConfig(kind, await readConfigStdin(input))
    return {kind, valid: true, version: config.version}
  }
  return action === 'config-set' ? configure(kind, await readConfigStdin(input)) : restoreConfiguration(kind)
}
