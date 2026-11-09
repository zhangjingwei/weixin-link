import {errorFields} from '../../infrastructure/diagnostics/diagnostic-log.mjs'

/** Management commands from WeChat. Installation, backend switching and
 * upgrades remain outside the ordinary model task queue.
 */
export function createManagementController({manager, jobs, runtime, setupReceipts, setupController, agentSwitcher, upgrader, view, log}) {
  const acknowledge = message => jobs.acknowledge([message._ingressId].filter(Boolean))
  return {
    async setup(action, message, deliver) {
      const receipt = message._setupReceiptId ? {id: message._setupReceiptId} : setupReceipts.capture(message)
      if (!receipt || !setupReceipts.claim(receipt.id)) {
        if (message._recovered) {
          await deliver('上次安装操作的结果需要核对，未重复执行。发送“安装向导”重新检测并继续。', {conversationControl: true})
          acknowledge(message)
        }
        return
      }
      const token = manager.lifecycle.capture(message.userId)
      const reply = (value, options = {}) => {
        if (!token.current()) throw Error('SETUP_CANCELLED')
        return options.sensitive ? view.sensitive(message.userId, value) : deliver(value, {current: () => token.current(), conversationControl: true})
      }
      await runtime.track('setup', () => setupController.handle(action, reply, {
        signal: token.signal,
        scope: message._conversationOwner ?? message.userId,
        executionKey: message.userId,
      }))
      setupReceipts.finish(receipt.id)
      acknowledge(message)
    },
    async agent(action, message, deliver, traceId) {
      await runtime.track('setup', async () => {
        try { await agentSwitcher.handle(action, value => runtime.track('delivery', () => deliver(value, {conversationControl: true}))) }
        catch (error) {
          log('agent.switch_failed', {trace_id: traceId, ...errorFields(error)})
          await deliver('智能体切换未完成；当前底座未确认改变。错误代码：' + (/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'AGENT_SWITCH_FAILED'), {conversationControl: true})
        } finally { acknowledge(message) }
      })
    },
    async upgrade(message, deliver, traceId) {
      await runtime.track('setup', async () => {
        try { await upgrader.handle(value => runtime.track('delivery', () => deliver(value, {conversationControl: true})), {traceId}) }
        catch (error) {
          log('upgrade.request_failed', {trace_id: traceId, ...errorFields(error)})
          await deliver('升级未安排。错误代码：' + (/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CHAT_UPGRADE_FAILED'), {conversationControl: true})
        } finally { acknowledge(message) }
      })
    },
  }
}

/** Management CLI entry for configuration. Validation and storage remain in
 * setup; the interface keeps action and argument parsing out of setup.mjs.
 */
export async function runConfigurationAction(action, args = [], input = process.stdin) {
  if (action === 'config-status') {
    if (args.length) throw Error('CONFIG_ARGUMENTS_INVALID')
    const {configStatus} = await import('../../setup/config-manager.mjs')
    return configStatus()
  }
  if (!['config-schema', 'config-check', 'config-set', 'config-restore'].includes(action) || args.length !== 1) throw Error('CONFIG_ARGUMENTS_INVALID')
  const kind = args[0]
  if (action === 'config-schema') {
    const {configSchema} = await import('../../setup/config-schema.mjs')
    return configSchema(kind)
  }
  if (action === 'config-check') {
    const {validateConfig} = await import('../../setup/config-schema.mjs')
    const {readConfigStdin} = await import('../../setup/config-manager.mjs')
    const config = validateConfig(kind, await readConfigStdin(input))
    return {kind, valid: true, version: config.version}
  }
  const {configure, readConfigStdin, restoreConfiguration} = await import('../../setup/config-manager.mjs')
  return action === 'config-set' ? configure(kind, await readConfigStdin(input)) : restoreConfiguration(kind)
}
