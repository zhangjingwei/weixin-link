#!/bin/sh
# Refresh pairing without reinstalling or upgrading the deployment.
set -eu
umask 077
if test "${1:-}" = --help; then
 echo '用法：sh qr.sh [账号名]（默认 default）'
 echo 'WEIXIN_LINK_DIR 指定安装源码目录；支持 Linux/macOS。'
 exit 0
fi
if test "$#" -gt 1; then echo '用法：sh qr.sh [账号名]' >&2; exit 1; fi
qr_account="${1:-${WEIXIN_LINK_ACCOUNT:-default}}"
qr_root="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
if test -z "${WEIXIN_LINK_DIR:-}${ZERO_LINK_DIR:-}" && test -d "$HOME/.local/share/zero-link/source"; then
 if test -e "$qr_root"; then echo '发现多个安装目录，请用 WEIXIN_LINK_DIR 指定。' >&2; exit 1; fi
 qr_root="$HOME/.local/share/zero-link/source"
fi
test -f "$qr_root/src/wechat/account-manager.mjs" || { echo '未找到安装，请通过 WEIXIN_LINK_DIR 指定源码目录。' >&2; exit 1; }
qr_node="$HOME/.local/share/wechat-ping-bot/tools/node/bin/node"
if ! test -x "$qr_node"; then qr_node=$(command -v node || true); fi
if test -z "$qr_node" || ! "$qr_node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
 echo '需要已有的 Node.js 24 或更新版本。' >&2; exit 1
fi
PATH="$(dirname "$qr_node"):$PATH"; export PATH
"$qr_node" - "$qr_root" "$qr_account" <<'NODE'
const {execFileSync} = require('node:child_process')
const {resolve} = require('node:path')
const {existsSync,readFileSync} = require('node:fs')
const root = resolve(process.argv[2]), account = process.argv[3]
const manager = resolve(root, 'src/wechat/account-manager.mjs')
try {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(account)) throw Error('INVALID_ACCOUNT_ID')
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  if (!['weixin-link','wechat-ping-bot'].includes(pkg.name) || !existsSync(manager)) throw Error('INSTALLATION_NOT_FOUND')
  const listing = JSON.parse(execFileSync(process.execPath,[manager,'list'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}))
  const current = listing.accounts?.find(row=>row.account===account)
  if (!current) throw Error('ACCOUNT_NOT_FOUND')
  if (current.ready) { console.log('微信账号已在线，无需重新扫码。请在微信发送「安装状态」检查。'); process.exit(0) }
  if (current.service_active) throw Error('ACCOUNT_RUNNING_NOT_READY')
  console.log('正在刷新微信登录二维码…')
  let result
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = JSON.parse(execFileSync(process.execPath,
        [manager, 'refresh-qr', account],
        {encoding:'utf8', timeout:60000, stdio:['ignore','pipe','pipe']}))
      break
    } catch (error) {
      let code
      try { code = JSON.parse(String(error.stdout)).error } catch {}
      if (process.platform !== 'darwin' || Number(code) !== 113 || attempt === 2) throw error
      console.log('macOS 登录服务正在重新注册，正在重试…')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
    }
  }
  if (!result.ok || result.status !== 'scan_to_login' || typeof result.path !== 'string' || !existsSync(result.path)) {
    throw Error('QR_IMAGE_UNAVAILABLE')
  }
  console.log('✓ 登录二维码已刷新。\n请用微信扫描 PNG 图片：\n' + result.path)
  const remote = process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY
  const viewer = !remote && process.stdout.isTTY && (process.platform === 'darwin' ? 'open' :
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? 'xdg-open' : null)
  if (viewer) {
    try {
      execFileSync(viewer, [result.path], {stdio:'ignore', timeout:5000})
      console.log('已打开二维码图片，请及时扫码。')
    } catch { console.log('无法自动打开图片，请手动打开上面的 PNG 文件。') }
  }
  console.log('扫码并在手机上确认后，请在微信发送「安装状态」继续配置。')
} catch (error) {
  let code = error.message
  try { code = JSON.parse(String(error.stdout)).error || code } catch {}
  if (Number(code) === 113) code = 'MACOS_SERVICE_NOT_FOUND'
  if (!/^[A-Z0-9_]+$/.test(code)) code = 'QR_REFRESH_FAILED'
  const messages={
    ACCOUNT_NOT_FOUND:'未找到该账号，请先创建账号档案。',
    ACCOUNT_RUNNING_NOT_READY:'账号服务正在运行但尚未就绪，未重新配对。请先检查服务状态。',
    ACCOUNT_ONLINE_NO_REFRESH_NEEDED:'账号已在线，无需重新扫码。',
    INSTALLATION_NOT_FOUND:'未找到有效安装，请通过 WEIXIN_LINK_DIR 指定源码目录。',
    INVALID_ACCOUNT_ID:'账号名无效，请使用小写字母开头的字母、数字或连字符。',
  }
  console.error(messages[code] || '无法刷新二维码，请稍后重试。')
  console.error('错误代码：' + code)
  process.exitCode = 1
}
NODE
