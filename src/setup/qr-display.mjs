import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readBrowserLoginUrl} from '../infrastructure/wechat/pairing-state.mjs'
import {setupLanguage} from './setup-locale.mjs'

const exec = promisify(execFile)

// A PNG is independent of terminal font metrics, line spacing and ANSI themes.
export async function displayQr(qr, stateDir, {
 output = process.stdout, platform = process.platform, env = process.env,
 run = exec, read = readFile, now = Date.now, human = false,language=setupLanguage(),
} = {}) {
 const en=language==='en'
 if (!output.isTTY && !human) return
 let loginUrl
 try {
  if (!output.isTTY) throw Error('NON_INTERACTIVE')
  const state = JSON.parse(await read(join(stateDir, 'pairing.json'), 'utf8'))
  if (state.status === 'waiting_scan' && now() < state.valid_until &&
      qr.path.endsWith('-' + state.qr_version + '.png')) {
   loginUrl = await readBrowserLoginUrl(stateDir,state.qr_version)
   const terminal = await read(join(stateDir, 'login-' + state.qr_version + '.terminal'), 'utf8')
   const lines = terminal.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
   if (lines.every(line => Array.from(line).length < (output.columns || 80))) {
    output.write(terminal + '\n')
   }
  }
 } catch { /* The PNG remains available if the terminal rendering is not ready. */ }
 if(loginUrl)output.write((en?'WeChat login link (open only on your own device; do not share):\n':'微信登录地址（仅在本机打开，请勿分享）：\n')+loginUrl+'\n')
 output.write((en?'Scan the QR code with WeChat. If it does not render correctly in the terminal, open this PNG:\n':'请用微信扫描二维码图片。若终端二维码变形或有断缝，请打开 PNG：\n')+qr.path+'\n')
 if (!output.isTTY || env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return
 const command = platform === 'win32' && loginUrl ? 'explorer.exe' : platform === 'darwin' ? 'open' :
  platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY) ? 'xdg-open' : null
 if (!command) return
 try {
  await run(command, [loginUrl??qr.path], {timeout: 5000})
  output.write(en?(loginUrl?'Opened the WeChat login link in your browser. Scan and confirm on your phone.\n':'Opened the QR image. Scan it before it expires.\n'):(loginUrl?'已在浏览器打开微信登录地址，请用手机微信扫码确认。\n':'已打开二维码图片，请及时扫码；过期后需刷新二维码。\n'))
 } catch {
  output.write(en?'Could not open a browser or image viewer. Use the link or PNG above.\n':'无法自动打开浏览器或图片，请手动使用上面的登录地址或 PNG。\n')
 }
}
