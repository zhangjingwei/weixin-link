#!/bin/bash
# Download Weixin Link into a persistent directory, then run its installer.
set -euo pipefail
umask 077
case "$(uname -s):$(uname -m)" in
  Linux:aarch64|Linux:x86_64|Darwin:arm64|Darwin:x86_64) ;;
  *) echo 'Supported: Linux/macOS arm64/x64. Windows: use install.ps1.' >&2; exit 1 ;;
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
  "$bootstrap_node" -e 'const p=require(process.argv[1]);if(!["weixin-link","wechat-ping-bot"].includes(p.name))process.exit(1)' "$bootstrap_dest/package.json" || { echo 'Unrecognized existing source directory.' >&2; exit 1; }
  bootstrap_accounts=$("$bootstrap_node" "$bootstrap_dest/src/wechat/account-manager.mjs" list)
  bootstrap_status=$("$bootstrap_node" -e 'const d=JSON.parse(process.argv[1]);const a=d.accounts?.find(a=>a.account==="default");if(!a)throw Error("DEFAULT_ACCOUNT_NOT_FOUND");console.log(a.ready?"online":a.service_active?"running":"offline")' "$bootstrap_accounts")
  if [[ "$bootstrap_status" = online ]]; then
    echo 'Already logged in. Send 安装状态 in WeChat to continue.'; exit 0
  fi
  if [[ "$bootstrap_status" = running ]]; then
    echo 'The account service is running but not ready; inspect its status before re-pairing.' >&2; exit 1
  fi
  echo 'Existing installation found; refreshing the login QR code without reinstalling.'
  "$bootstrap_node" "$bootstrap_dest/src/wechat/account-manager.mjs" refresh-qr default
  "$bootstrap_node" "$bootstrap_dest/src/setup/setup.mjs" qr default
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
