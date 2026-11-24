import test from 'node:test'
import assert from 'node:assert/strict'
import {setImmediate as tick} from 'node:timers/promises'
import {WeChatBot} from 'wechatbot-zerolink'
import {RuntimeControl} from '../../src/infrastructure/runtime/runtime-control.mjs'
import {createPollingLifecycle} from '../../src/wechat/polling-lifecycle.mjs'

function fixture() {
  const bot = new WeChatBot({storage:'memory', logLevel:'silent'})
  bot.setCredentials({baseUrl:'https://example.invalid', token:'test'})
  const context = Promise.withResolvers()
  const events = []
  let loggedIn = false
  bot.contextStore.load = async () => { await context.promise; events.push('loaded') }
  bot.api.notifyStart = bot.api.notifyStop = async () => {}
  bot.api.getUpdates = (_url, _token, _cursor, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once:true})
  })
  const runtime = new RuntimeControl({
    snapshot:()=>({}), onSeal:()=>polling.seal(), onResume:()=>polling.release(),
    onDrainRelease:()=>polling.release(),
  })
  const polling = createPollingLifecycle({bot, runtime, canRun:()=>loggedIn,
    recover:()=>events.push('recover'), replay:()=>events.push('replay'),
    onReady:()=>{assert.equal(bot.isRunning,true);events.push('ready')}})
  return {bot, runtime, polling, events, context, login:()=>{loggedIn=true}}
}

test('login while sealed waits for resume and loaded context; replay runs while polling', async () => {
  const f = fixture()
  const command = action => f.runtime.command(action,'test-lease')
  command('drain'); command('seal')
  f.login()
  await f.polling.start()
  assert.deepEqual(f.events,[])
  command('resume')
  await tick()
  command('drain')
  assert.throws(()=>command('seal'),/busy/i)
  command('resume')
  f.context.resolve()
  await tick()
  assert.equal(f.bot.isRunning,true)
  assert.deepEqual(f.events,['loaded','ready','recover','replay'])
  command('drain'); command('seal'); command('resume')
  await tick()
  assert.equal(f.bot.isRunning,true)
  assert.deepEqual(f.events,['loaded','ready','recover','replay','loaded','ready','replay'])
  command('drain'); command('seal')
})

test('resume before login cannot start polling',async()=>{
  const f=fixture()
  f.runtime.command('drain','test-lease')
  f.runtime.command('seal','test-lease')
  f.runtime.command('resume','test-lease')
  f.context.resolve()
  await tick()
  assert.deepEqual(f.events,[])
  assert.equal(f.bot.isRunning,false)
})
