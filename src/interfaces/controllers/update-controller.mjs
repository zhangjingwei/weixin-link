import {UpdateNotifier} from '../../application/notifications/update-notifier.mjs'

/** Periodic release checks enter through this controller. Version comparison,
 * deduplication and unknown-delivery state stay in UpdateNotifier.
 */
export function createUpdateController({stateDir, sourceDir, owners, ready, view, log, fetchLatest, now}) {
  const notifier = new UpdateNotifier({
    stateDir, sourceDir, owners, ready, log, ...(fetchLatest ? {fetchLatest} : {}), ...(now ? {now} : {}),
    send: (owner, text) => view.notice(owner, text, {current: ready}),
  })
  return {
    start: () => notifier.start(),
    tick: () => notifier.tick(),
    close: () => notifier.close(),
  }
}
