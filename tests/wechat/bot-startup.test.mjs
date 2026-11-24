import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {accountPaths} from '../../src/infrastructure/accounts/account-store.mjs'

test('normal bot startup opens the inbox and answers the upgrade readiness probe', async t => {
  const home = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'wx-start-'))
  t.after(() => rm(home, {recursive:true, force:true}))
  const {stateDir} = accountPaths('default', home)
  await mkdir(stateDir, {recursive:true})
  await writeFile(join(stateDir, 'codex-owners.json'), JSON.stringify(['test-owner']))
  const script = `
    import assert from 'node:assert/strict'
    import {readFile} from 'node:fs/promises'
    import {join} from 'node:path'
    import {WeChatBot} from 'wechatbot-zerolink'
    import {accountPaths} from './src/infrastructure/accounts/account-store.mjs'
    import {controlRequest} from './src/infrastructure/runtime/runtime-control.mjs'
    WeChatBot.prototype.login = async function () {
      this.credentials = {accountId:'test-account'}
      this.emit('login', this.credentials)
    }
    WeChatBot.prototype.start = async function () {
      Object.defineProperty(this, 'isRunning', {value:true})
      const status = await controlRequest(accountPaths().socket, 'GET', '/status')
      assert.equal(status.ready, true)
      assert.equal(status.startup, 'login_complete')
      const eventsFile=join(accountPaths().stateDir,'logs','events.jsonl')
      await new Promise(resolve=>setTimeout(resolve,30))
      const before=await readFile(eventsFile,'utf8')
      assert.doesNotMatch(before, /"event":"service.ready"/)
      this.emit('poll:start')
      await new Promise(resolve=>setTimeout(resolve,30))
      const after=await readFile(eventsFile,'utf8')
      assert.match(after, /"event":"service.ready"/)
      console.log('startup probe passed')
      process.exit(0)
    }
    await import('./src/wechat/bot.mjs')
  `
  const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    cwd:fileURLToPath(new URL('../..', import.meta.url)), timeout:15000,
    env:{PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, HOME:home, USERPROFILE:home, CODEX_HOME:join(home,'.codex')},
  })
  assert.match(stdout, /startup probe passed/)
})
