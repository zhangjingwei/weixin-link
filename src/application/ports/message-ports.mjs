/** Narrow functions available to message use cases. The composition root may
 * own SDK clients and constructors, but no SDK object is exposed here.
 */
export function messagePorts({infrastructure, delivery, stateDir, cwd}) {
  const candidate = {
    agent: {checkReady: infrastructure?.agent?.readiness},
    media: {has: infrastructure?.media?.has, prepare: infrastructure?.media?.prepare, compose: infrastructure?.media?.compose,
      package: typeof infrastructure?.media?.outputStore === 'function' && typeof stateDir === 'string' && typeof cwd === 'string'
        ? (userId, value) => infrastructure.media.outputStore({stateDir, cwd}).package(userId, value) : undefined},
    references: {quoteInput: infrastructure?.wechat?.quoteInput},
    delivery: {deliver: delivery?.deliver, confirmedRejection: infrastructure?.wechat?.confirmedFinalRejection},
  }
  if (Object.values(candidate).some(group => Object.values(group).some(value => typeof value !== 'function'))) throw Error('MESSAGE_PORT_INVALID')
  return Object.freeze(Object.fromEntries(Object.entries(candidate).map(([name, group]) => [name, Object.freeze(group)])))
}
