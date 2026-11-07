import {join} from 'node:path'
import manifest from './manifest.json' with {type: 'json'}
import schema from './config-schema.mjs'
import {createRsshubClient} from './client.mjs'

export default {
  manifest, schema,
  configPath: ({home}) => join(home, '.config/wechat-assistant/rsshub.json'),
  guidanceUrl: new URL('./guidance.md', import.meta.url),
  async health(config) {
    const names = Object.keys(config.feeds)
    if (!names.length || names.length > 50) throw Error('RSSHUB_FEEDS_INVALID')
    await createRsshubClient(config).latest(names[0], 1)
  },
  async invoke(config, request) {
    if (!request || request.operation !== 'latest') throw Error('INTEGRATION_OPERATION_NOT_ALLOWED')
    if (typeof request.source !== 'string' || request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 30) || Object.keys(request).some(key => !['operation', 'source', 'limit'].includes(key))) throw Error('INTEGRATION_ARGUMENTS_INVALID')
    return createRsshubClient(config).latest(request.source, request.limit ?? 10)
  },
}
