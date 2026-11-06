#!/bin/bash
# Download Weixin Link into a persistent directory, then run its installer.
set -euo pipefail
umask 077
case "$(uname -s):$(uname -m)" in
  Linux:aarch64|Linux:x86_64|Darwin:arm64|Darwin:x86_64) ;;
  *) echo 'Supported: Linux/macOS arm64/x64. Windows: use install.ps1.' >&2; exit 1 ;;
esac
# Discover registered services before downloading tools or creating another source tree.
case "$(uname -s)" in
 Linux)
  if command -v systemctl >/dev/null 2>&1; then
   existing_service=$(systemctl --user show wechat-ping-bot.service --property=LoadState --property=ActiveState --property=FragmentPath 2>/dev/null || true)
   existing_fragment=$(printf '%s\n' "$existing_service" | sed -n 's/^FragmentPath=//p')
   existing_source="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
   resume_pairing=false
   if ! printf '%s\n' "$existing_service" | grep -q '^ActiveState=active$' && test -f "$existing_fragment" && grep -q '^# Managed by wechat-assistant setup v1$' "$existing_fragment" && test -f "$existing_source/src/wechat/account-manager.mjs"; then
    resume_pairing=true
   fi
   if test -n "$existing_fragment" && test "$resume_pairing" = false; then
    echo '检测到已有 Weixin Link 后台服务，跳过重复安装。'
    printf '%s\n' "$existing_service" | grep -E '^(ActiveState|FragmentPath)=' || true
    echo '服务状态不代表微信登录状态；可在微信发送「安装状态」检查。升级请使用独立升级入口。'
    exit 0
   fi
  fi
  ;;
 Darwin)
  if launchctl print "gui/$(id -u)/com.wechat-assistant.wechat-ping-bot" >/dev/null 2>&1; then
   echo '检测到已有 Weixin Link 后台服务，跳过重复安装。'
   echo '可在微信发送「安装状态」检查；升级请使用独立升级入口。'
   exit 0
  fi
  ;;
esac
for bootstrap_cmd in curl tar mktemp; do
  command -v "$bootstrap_cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $bootstrap_cmd" >&2; exit 1; }
done
bootstrap_ref="${WEIXIN_LINK_REF:-${ZERO_LINK_REF:-main}}"
bootstrap_dest="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
# Reuse a legacy source directory rather than creating a parallel installation.
if [[ -z "${WEIXIN_LINK_DIR:-}" && -z "${ZERO_LINK_DIR:-}" && ( -e "$HOME/.local/share/zero-link/source" || -L "$HOME/.local/share/zero-link/source" ) ]]; then
  if [[ -e "$bootstrap_dest" || -L "$bootstrap_dest" ]]; then
    echo 'Multiple source directories exist; select one with WEIXIN_LINK_DIR.' >&2; exit 1
  fi
  bootstrap_dest="$HOME/.local/share/zero-link/source"
fi
if [[ -e "$bootstrap_dest" || -L "$bootstrap_dest" ]]; then
  if [[ -L "$bootstrap_dest" || ! -d "$bootstrap_dest" || ! -f "$bootstrap_dest/package.json" || ! -f "$bootstrap_dest/src/wechat/account-manager.mjs" || ! -f "$bootstrap_dest/src/setup/setup.mjs" ]]; then
    echo "Installation directory already exists but is not a supported installation: $bootstrap_dest" >&2; exit 1
  fi
  bootstrap_node="$HOME/.local/share/wechat-ping-bot/tools/node/bin/node"
  if [[ ! -x "$bootstrap_node" ]]; then bootstrap_node=$(command -v node || true); fi
  if [[ -z "$bootstrap_node" ]] || ! "$bootstrap_node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
    echo 'Existing installation needs Node.js 24+ before pairing can resume.' >&2; exit 1
  fi
  "$bootstrap_node" -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));if(!["weixin-link","wechat-ping-bot"].includes(p.name))process.exit(1)' "$bootstrap_dest/package.json" || { echo 'Unrecognized existing source directory.' >&2; exit 1; }
  bootstrap_accounts=$("$bootstrap_node" "$bootstrap_dest/src/wechat/account-manager.mjs" list)
  bootstrap_status=$("$bootstrap_node" -e 'const d=JSON.parse(process.argv[1]);const a=d.accounts?.find(a=>a.account==="default");if(!a)throw Error("DEFAULT_ACCOUNT_NOT_FOUND");console.log(a.ready?"online":a.service_active?"running":"offline")' "$bootstrap_accounts")
  if [[ "$bootstrap_status" = online ]]; then
    echo '微信已登录，请发送「安装状态」继续配置。'; exit 0
  fi
  if [[ "$bootstrap_status" = running ]]; then
    echo 'The account service is running but not ready; inspect its status before re-pairing.' >&2; exit 1
  fi
  echo '检测到已有安装，正在刷新微信登录二维码…'
  # Handle legacy JSON here: installed sources may predate --human and PNG opening.
  "$bootstrap_node" - "$bootstrap_dest" <<'NODE'
const {execFileSync} = require('node:child_process')
const {resolve} = require('node:path')
const {existsSync} = require('node:fs')
const root = resolve(process.argv[2])
try {
  let result
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = JSON.parse(execFileSync(process.execPath,
        [resolve(root, 'src/wechat/account-manager.mjs'), 'refresh-qr', 'default'],
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
  console.error('无法刷新二维码，请稍后重试。错误代码：' + code)
  process.exitCode = 1
}
NODE
  exit 0
fi
mkdir -p "$(dirname -- "$bootstrap_dest")"
bootstrap_tmp=$(mktemp -d "$(dirname -- "$bootstrap_dest")/.weixin-link-download.XXXXXX")
trap 'rm -rf -- "$bootstrap_tmp"' EXIT
curl -fSL --proto '=https' --tlsv1.2 \
  "https://api.github.com/repos/zhangjingwei/weixin-link/tarball/$bootstrap_ref" -o "$bootstrap_tmp/source.tar.gz"
mkdir "$bootstrap_tmp/source"
tar -xzf "$bootstrap_tmp/source.tar.gz" -C "$bootstrap_tmp/source" --strip-components=1
[[ -f "$bootstrap_tmp/source/install.sh" && -f "$bootstrap_tmp/source/package.json" ]] || {
  echo 'Downloaded archive is missing installation files.' >&2; exit 1;
}
# Reserve destination without overwriting another installation.
mkdir "$bootstrap_dest"
cp -R "$bootstrap_tmp/source/." "$bootstrap_dest/"
cd "$bootstrap_dest"
/bin/sh ./install.sh
