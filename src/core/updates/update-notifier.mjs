// Compatibility entry point for callers that still pass local directories.
import {UpdateNotifier as ApplicationUpdateNotifier} from '../../application/notifications/update-notifier.mjs'
import {createUpdateNoticeStateStore} from '../../infrastructure/storage/update-notice-state.mjs'
import {readInstalledRelease, fetchLatestRelease} from '../../infrastructure/updates/release-source.mjs'

export class UpdateNotifier extends ApplicationUpdateNotifier {
  constructor({stateDir, sourceDir, stateStore = createUpdateNoticeStateStore(stateDir), readInstalled = () => readInstalledRelease(sourceDir), fetchLatest = fetchLatestRelease, ...options}) {
    super({stateStore, readInstalled, fetchLatest, ...options})
  }
  path(owner) {return this.stateStore.path(owner)}
}
