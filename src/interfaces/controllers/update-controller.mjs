import {UpdateNotifier} from '../../application/notifications/update-notifier.mjs'
import {createUpdateNoticeStateStore} from '../../infrastructure/storage/update-notice-state.mjs'
import {readInstalledRelease, fetchLatestRelease} from '../../infrastructure/updates/release-source.mjs'

/** Periodic release checks enter through this controller. Version comparison,
 * deduplication and unknown-delivery state stay in UpdateNotifier.
 */
export function createUpdateController({stateDir, sourceDir, owners, ready, view, log, fetchLatest, now}) {
  const notifier = new UpdateNotifier({
    stateStore: createUpdateNoticeStateStore(stateDir), readInstalled: () => readInstalledRelease(sourceDir),
    owners, ready, log, fetchLatest: fetchLatest ?? fetchLatestRelease, ...(now ? {now} : {}),
    send: (owner, text) => view.notice(owner, text, {current: ready}),
  })
  return {
    start: () => notifier.start(),
    tick: () => notifier.tick(),
    close: () => notifier.close(),
  }
}
