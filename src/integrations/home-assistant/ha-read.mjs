// Compatibility entry point. The account must explicitly enable home-assistant first.
import {invokeIntegration} from '../runtime.mjs'
try {
  const [operation, value = '', hours = '24', ...extra] = process.argv.slice(2)
  if (extra.length || !['states', 'history'].includes(operation)) throw Error('INTEGRATION_ARGUMENTS_INVALID')
  const request = operation === 'states' ? {operation, query: value} : {operation, entityId: value, hours: Number(hours)}
  console.log(JSON.stringify(await invokeIntegration('home-assistant', request)))
} catch (error) {
  console.error(/^(?:CONFIG|INTEGRATION)_[A-Z_]+$/.test(error.message) ? error.message : 'INTEGRATION_FAILED')
  process.exitCode = 1
}
