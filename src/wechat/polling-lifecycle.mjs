// poll:start follows SDK context loading. The start() promise covers the entire
// poll loop, including its final offline notification.
export function createPollingLifecycle({bot, runtime, canRun, recover, replay}) {
  let active, retiring
  let contextReady = false
  let recovered = false

  function release() {
    if (!canRun() || runtime.sealed || runtime.draining) return
    if (!contextReady) return start()
    if (!recovered) {
      recover()
      recovered = true
    }
    replay()
  }

  async function start() {
    if (retiring) await retiring
    if (!canRun() || runtime.sealed || runtime.draining || active) return
    const leave = runtime.enter('poll_start')
    const ready = Promise.withResolvers()
    bot.on('poll:start', ready.resolve)
    const run = bot.start()
    active = run
    try {
      await Promise.race([ready.promise, run])
      if (active === run && bot.isRunning) {
        contextReady = true
        release()
      }
      leave()
      await run
    } catch (error) {
      if (active === run && bot.isRunning) {
        bot.stop()
        await run.catch(() => {})
      }
      throw error
    } finally {
      leave()
      bot.off('poll:start', ready.resolve)
      if (active === run) {
        active = undefined
        contextReady = false
      }
    }
  }

  function seal() {
    if (active) retiring = active.catch(() => {})
    active = undefined
    contextReady = false
    bot.stop()
  }

  return {start, seal, release}
}
