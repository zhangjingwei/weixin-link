#!/bin/sh
# Refresh pairing without reinstalling or upgrading the deployment.
set -eu
umask 077
if test "${1:-}" = --help; then
 echo '用法：sh qr.sh [--relogin] [账号名]（默认 default）'
 echo 'WEIXIN_LINK_DIR 指定安装源码目录；支持 Linux/macOS。'
 exit 0
fi
qr_relogin="${WEIXIN_LINK_RELOGIN:-0}"
if test "${1:-}" = --relogin; then qr_relogin=1; shift; fi
if test "$#" -gt 1; then echo '用法：sh qr.sh [--relogin] [账号名]' >&2; exit 1; fi
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
"$qr_node" - "$qr_root" "$qr_account" "$qr_relogin" <<'NODE'
const {execFileSync} = require('node:child_process')
const {resolve} = require('node:path')
const {existsSync,readFileSync} = require('node:fs')
const root = resolve(process.argv[2]), account = process.argv[3], relogin = process.argv[4] === '1'
const manager = resolve(root, 'src/wechat/account-manager.mjs')
try {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(account)) throw Error('INVALID_ACCOUNT_ID')
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  if (!['weixin-link','wechat-ping-bot'].includes(pkg.name) || !existsSync(manager)) throw Error('INSTALLATION_NOT_FOUND')
  const listing = JSON.parse(execFileSync(process.execPath,[manager,'list'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}))
  const current = listing.accounts?.find(row=>row.account===account)
  if (!current) throw Error('ACCOUNT_NOT_FOUND')
  if (!relogin && current.ready) {
    console.log('本地服务报告就绪，但这不能确认微信绑定仍有效。')
    console.log('如果已解绑或需要重新授权，请使用 qr.sh --relogin（远程命令可设置 WEIXIN_LINK_RELOGIN=1）。')
    process.exit(0)
  }
  if (current.service_active && !relogin) throw Error('ACCOUNT_RUNNING_NOT_READY')
  if (relogin && current.service_active) {
    console.log('已选择重新登录，正在等待当前任务结束并安全停止账号服务…')
    const stopped=JSON.parse(execFileSync(process.execPath,[manager,'stop',account],{encoding:'utf8',timeout:650000,stdio:['ignore','pipe','pipe']}))
    if (!stopped.ok || stopped.status !== 'stopped') throw Error('ACCOUNT_STOP_UNCONFIRMED')
  }
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
  console.log('✓ 登录二维码已刷新。')
  const remote = process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY
  const viewer = !remote && process.stdout.isTTY && (process.platform === 'darwin' ? 'open' :
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? 'xdg-open' : null)
  let opened = false
  if (viewer) {
    try {
      execFileSync(viewer, [result.path], {stdio:'ignore', timeout:5000})
      opened = true
      console.log('已打开二维码图片，请及时扫码。')
    } catch { console.log('无法自动打开图片，尝试在终端显示二维码。') }
  }
  let displayed = false
  if (!opened && process.stdout.isTTY) {
    const base=resolve(process.env.HOME, '.local/share/wechat-ping-bot')
    const stateDir=account==='default'?base:resolve(base,'accounts',account)
    // The pairing worker publishes the PNG before writing its terminal rendering.
    for(let attempt=0;attempt<10;attempt++){
      try {
        const state=JSON.parse(readFileSync(resolve(stateDir,'pairing.json'),'utf8'))
        if(state.status!=='waiting_scan'||!Number.isFinite(state.valid_until)||Date.now()>=state.valid_until||
          !/^[a-f0-9-]{36}$/.test(state.qr_version)||!result.path.endsWith('-'+state.qr_version+'.png')) break
        const terminal=readFileSync(resolve(stateDir,'login-'+state.qr_version+'.terminal'),'utf8')
        const lines=terminal.replace(/\x1b\[[0-9;]*m/g,'').split('\n')
        const width=Math.max(...lines.map(line=>Array.from(line).length))
        if(width>=(process.stdout.columns||80)){
          console.log('终端宽度不足，请放大窗口后重试，或打开下方 PNG 文件。')
          break
        }
        console.log('请直接用微信扫描下方二维码：')
        process.stdout.write(terminal+'\n')
        displayed=true
        break
      }catch{}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100)
    }
  }
  if(!opened&&!displayed) console.log('未能在终端显示二维码，请打开 PNG 图片扫码。')
  console.log((displayed?'备用 PNG（终端显示有断缝或扫码失败时使用）：':'二维码 PNG：')+'\n'+result.path)
  console.log('扫码并在手机上确认后，请在微信发送「安装状态」继续配置。')
} catch (error) {
  let code = error.message
  try { code = JSON.parse(String(error.stdout)).error || code } catch {}
  if (Number(code) === 113) code = 'MACOS_SERVICE_NOT_FOUND'
  if (!/^[A-Z0-9_]+$/.test(code)) code = 'QR_REFRESH_FAILED'
  const messages={
    ACCOUNT_STOP_UNCONFIRMED:'未能确认服务安全停止，没有生成新二维码。请先检查服务状态。',
    ACCOUNT_NOT_FOUND:'未找到该账号，请先创建账号档案。',
    ACCOUNT_RUNNING_NOT_READY:'账号服务正在运行但尚未就绪，未重新配对。请先检查服务状态。',
    ACCOUNT_ONLINE_NO_REFRESH_NEEDED:'账号服务仍在运行，无法刷新二维码。需要重新授权时请使用 --relogin。',
    INSTALLATION_NOT_FOUND:'未找到有效安装，请通过 WEIXIN_LINK_DIR 指定源码目录。',
    INVALID_ACCOUNT_ID:'账号名无效，请使用小写字母开头的字母、数字或连字符。',
  }
  console.error(messages[code] || '无法刷新二维码，请稍后重试。')
  console.error('错误代码：' + code)
  process.exitCode = 1
}
NODE
