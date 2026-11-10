/** Structural contracts for external effects used by application use cases.
 * A port is a function-only facade; its adapter remains responsible for
 * provider credentials, SDK objects, files and delivery uncertainty.
 */
const METHODS = {
  wechat: ['createClient', 'installProtocol', 'quoteInput', 'createOutbound', 'confirmedFinalRejection'],
  agent: ['load', 'readiness'],
  media: ['has', 'prepare', 'compose', 'outputStore', 'outputTransport'],
  integrations: ['guidance', 'status', 'check', 'invoke'],
  storage: ['registryStore', 'inbox', 'accountInbox'],
}

export function defineInfrastructurePorts(ports) {
  if (!ports || typeof ports !== 'object') throw Error('INFRASTRUCTURE_PORT_INVALID')
  for (const [name, methods] of Object.entries(METHODS)) {
    if (!ports[name] || methods.some(method => typeof ports[name][method] !== 'function')) throw Error('INFRASTRUCTURE_PORT_INVALID')
  }
  return Object.freeze(Object.fromEntries(Object.entries(METHODS).map(([name, methods]) => [name,
    Object.freeze(Object.fromEntries(methods.map(method => [method, ports[name][method]])))])))
}
