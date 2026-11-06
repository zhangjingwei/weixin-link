import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec = promisify(execFile)

// A PNG is independent of terminal font metrics, line spacing and ANSI themes.
export async function displayQr(qr, stateDir, {
 output = process.stdout, platform = process.platform, env = process.env,
 run = exec, read = readFile, now = Date.now, human = false,
} = {}) {
 if (!output.isTTY && !human) return
 try {
  if (!output.isTTY) throw Error('NON_INTERACTIVE')
  const state = JSON.parse(await read(join(stateDir, 'pairing.json'), 'utf8'))
  if (state.status === 'waiting_scan' && now() < state.valid_until &&
      qr.path.endsWith('-' + state.qr_version + '.png')) {
   const terminal = await read(join(stateDir, 'login-' + state.qr_version + '.terminal'), 'utf8')
   const lines = terminal.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
   if (lines.every(line => Array.from(line).length < (output.columns || 80))) {
    output.write(terminal + '\n')
   }
  }
 } catch { /* The PNG remains available if the terminal rendering is not ready. */ }
 output.write(`请用微信扫描二维码图片。若终端二维码变形或有断缝，请打开 PNG：\n${qr.path}\n`)
 if (!output.isTTY || env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return
 const command = platform === 'darwin' ? 'open' :
  platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY) ? 'xdg-open' : null
 if (!command) return
 try {
  await run(command, [qr.path], {timeout: 5000})
  output.write('已打开二维码图片，请及时扫码；过期后需刷新二维码。\n')
 } catch {
  output.write('无法自动打开图片，请手动打开上面的 PNG 文件。\n')
 }
}
