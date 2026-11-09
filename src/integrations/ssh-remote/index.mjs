import {join, dirname} from 'node:path'
import {access} from 'node:fs/promises'
import manifest from './manifest.json' with {type: 'json'}

const allowed = new Set(manifest.capabilities)
export default {
  manifest,
  guidanceUrl: new URL('./guidance.md', import.meta.url),
  async configPath({home, workspace, env = process.env}) {
    const {installConfig} = await import('../../infrastructure/config/install-config.mjs')
    return env.WECHAT_REMOTE_HOSTS ?? join(workspace ?? env.WECHAT_REMOTE_WORKSPACE ?? installConfig(home).workspace, 'remote-hosts.json')
  },
  async health(config) {
    const hosts = Object.keys(config.hosts)
    if (!hosts.length) throw Error('REMOTE_HOSTS_REQUIRED')
    const {RemoteRpc} = await import('../../infrastructure/agents/remote-rpc.mjs')
    const host = hosts[0], rpc = new RemoteRpc(host, {hostConfig: config.hosts[host], retryDelays: []})
    try { await rpc.connect(); await rpc.request('thread/list', {limit: 1}, 6000) } finally { rpc.close() }
  },
  async invoke(config, request, {home, account, scope, workspace, env}) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !allowed.has(request.action)) throw Error('INTEGRATION_OPERATION_NOT_ALLOWED')
    if (typeof scope !== 'string' || !scope || scope.length > 200) throw Error('INTEGRATION_ARGUMENTS_INVALID')
    const {RemoteController} = await import('../../application/remote-tasks/remote-controller.mjs')
    const {resolveRemoteWorkspace} = await import('../../infrastructure/remote/workspace.mjs')
    const root = resolveRemoteWorkspace({home, workspace, env})
    const configPath = await this.configPath({home, workspace, env})
    // An earlier plugin could put its ledger beside a custom config. Refuse
    // that split state instead of silently creating an unrelated ledger.
    if (dirname(configPath) !== root) {
      try { await access(join(dirname(configPath), 'remote-sessions.json')); throw Error('REMOTE_STATE_LOCATION_MISMATCH') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    // Use the same thread scope as the existing /stop cleanup and remote CLI.
    return new RemoteController({root, account, scope, hosts: config.hosts, configPath}).run(request)
  },
}
