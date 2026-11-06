#!/bin/sh
# Explicit upgrade for standard installations. Never called by install/bootstrap.
set -eu
umask 077
upgrade_target="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
upgrade_ref="${WEIXIN_LINK_REF:-main}"
upgrade_node="$HOME/.local/share/wechat-ping-bot/tools/node/bin/node"
if ! test -x "$upgrade_node"; then upgrade_node=$(command -v node || true); fi
if test -z "$upgrade_node" || ! "$upgrade_node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
 echo '升级需要已有的 Node.js 24 或更新版本。'; exit 1
fi
PATH="$(dirname "$upgrade_node"):$PATH"; export PATH
test -d "$upgrade_target" || { echo '未找到已安装的源码目录，请通过 WEIXIN_LINK_DIR 指定。'; exit 1; }
for upgrade_cmd in curl tar mktemp; do command -v "$upgrade_cmd" >/dev/null 2>&1 || { echo "缺少命令：$upgrade_cmd"; exit 1; }; done
upgrade_temp=$(mktemp -d)
trap 'rm -rf "$upgrade_temp"' EXIT HUP INT TERM
echo '下载升级版本…'
curl -fsSL --proto '=https' --tlsv1.2 "https://api.github.com/repos/zhangjingwei/weixin-link/tarball/$upgrade_ref" -o "$upgrade_temp/source.tar.gz"
mkdir "$upgrade_temp/source"
tar -xzf "$upgrade_temp/source.tar.gz" -C "$upgrade_temp/source" --strip-components=1
test -f "$upgrade_temp/source/src/setup/upgrade.mjs" || { echo '该版本不支持独立升级。'; exit 1; }
"$upgrade_node" "$upgrade_temp/source/src/setup/upgrade.mjs" "$upgrade_target"
