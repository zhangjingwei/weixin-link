#!/bin/sh
# One local bootstrap; after WeChat pairing, continue through WeChat commands.
set -eu
umask 077
case "$(uname -s):$(uname -m)" in Linux:aarch64) setup_os=linux; setup_arch=arm64;; Linux:x86_64) setup_os=linux; setup_arch=x64;; Darwin:arm64) setup_os=darwin; setup_arch=arm64;; Darwin:x86_64) setup_os=darwin; setup_arch=x64;; *) echo 'Supported: Linux/macOS arm64/x64; Windows: install.ps1'; exit 1;; esac
# Discover registered services before downloading tools or creating another source tree.
case "$(uname -s)" in
 Linux)
  if command -v systemctl >/dev/null 2>&1; then
   existing_service=$(systemctl --user show wechat-ping-bot.service --property=LoadState --property=ActiveState --property=FragmentPath 2>/dev/null || true)
   if printf '%s\n' "$existing_service" | grep -q '^FragmentPath=.'; then
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
setup_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
setup_private_node="${HOME}/.local/share/wechat-ping-bot/tools/node/bin/node"
if test -x "$setup_private_node"; then PATH="$(dirname "$setup_private_node"):$PATH"; export PATH; fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' ; then
 for setup_cmd in curl tar; do command -v "$setup_cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $setup_cmd"; exit 1; }; done
 setup_version=v24.21.0
 setup_tools="${HOME}/.local/share/wechat-ping-bot/tools"
 mkdir -p "$setup_tools"
 setup_tmp=$(mktemp -d "$setup_tools/node-download.XXXXXX")
 trap 'rm -rf "$setup_tmp"' EXIT HUP INT TERM
 setup_archive="node-${setup_version}-${setup_os}-${setup_arch}.tar.gz"
 curl -fsSL --proto '=https' --tlsv1.2 "https://nodejs.org/dist/${setup_version}/${setup_archive}" -o "$setup_tmp/$setup_archive"
 curl -fsSL --proto '=https' --tlsv1.2 "https://nodejs.org/dist/${setup_version}/SHASUMS256.txt" -o "$setup_tmp/SHASUMS256.txt"
 (cd "$setup_tmp"; awk -v name="$setup_archive" '$2==name {print}' SHASUMS256.txt > checksum; test -s checksum; if command -v sha256sum >/dev/null 2>&1; then sha256sum -c checksum; else shasum -a 256 -c checksum; fi)
 if test -e "$setup_tools/node"; then echo 'Managed Node directory exists; inspect before replacing'; exit 1; fi
 tar -xzf "$setup_tmp/$setup_archive" -C "$setup_tmp"
 mv "$setup_tmp/node-${setup_version}-${setup_os}-${setup_arch}" "$setup_tools/node"
 PATH="$setup_tools/node/bin:$PATH"; export PATH
fi
command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }
if test "$setup_os" = linux; then
for setup_cmd in flock systemctl systemd-run; do command -v "$setup_cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $setup_cmd"; exit 1; }; done
systemctl --user is-active default.target >/dev/null 2>&1 || { echo 'User systemd session is unavailable; log in normally or configure user services first.'; exit 1; }
else
 launchctl print "gui/$(id -u)" >/dev/null 2>&1 || { echo 'A logged-in macOS GUI session is required.'; exit 1; }
fi
cd "$setup_root"
node src/setup/setup.mjs init --human
node src/setup/setup.mjs deps --human
node src/setup/setup.mjs services --human
node src/setup/setup.mjs pair --human
./wechat-setup qr --human
