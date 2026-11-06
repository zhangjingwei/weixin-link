import {join} from 'node:path'
import manifest from './manifest.json' with {type: 'json'}
import schema from './config-schema.mjs'

// Keep descriptors free of setup/runtime imports: schemas can discover them safely.
export default {
  manifest,
  schema,
  configPath: ({home}) => join(home, '.config/wechat-assistant/ha.json'),
  guidanceUrl: new URL('./guidance.md', import.meta.url),
  async health(config) {
    const {createHaClient} = await import('./client.mjs')
    return createHaClient(config).health()
  },
  async invoke(config, request) {
    if (!request || !['states', 'history'].includes(request.operation)) throw Error('INTEGRATION_OPERATION_NOT_ALLOWED')
    const allowed = request.operation === 'states' ? ['operation', 'query'] : ['operation', 'entityId', 'hours']
    if (Object.keys(request).some(key => !allowed.includes(key)) ||
        request.query !== undefined && typeof request.query !== 'string' ||
        request.operation === 'history' && (typeof request.entityId !== 'string' || request.hours !== undefined && typeof request.hours !== 'number')) {
      throw Error('INTEGRATION_ARGUMENTS_INVALID')
    }
    if (request.operation === 'history' && (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(request.entityId) || request.hours !== undefined && (!Number.isFinite(request.hours) || request.hours < 1 || request.hours > 168))) throw Error('INTEGRATION_ARGUMENTS_INVALID')
    const {createHaClient} = await import('./client.mjs')
    const client = createHaClient(config)
    return request.operation === 'states' ? client.states(request.query) : client.history(request.entityId, request.hours ?? 24)
  },
}
