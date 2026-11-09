#!/bin/sh
# Install or upgrade a standard Weixin Link deployment from one shell entry.
set -eu
umask 077
case "$(uname -s):$(uname -m)" in
  Linux:aarch64|Linux:x86_64|Darwin:arm64|Darwin:x86_64) ;;
  *) echo 'Supported: Linux/macOS arm64/x64. Windows: use install.ps1 in PowerShell.' >&2; exit 1 ;;
esac
# The same entry installs a fresh deployment or upgrades a known source tree.
bootstrap_dest="${WEIXIN_LINK_DIR:-${ZERO_LINK_DIR:-$HOME/.local/share/weixin-link/source}}"
if test -z "${WEIXIN_LINK_DIR:-}${ZERO_LINK_DIR:-}" && { test -e "$HOME/.local/share/zero-link/source" || test -L "$HOME/.local/share/zero-link/source"; }; then
  if test -e "$bootstrap_dest" || test -L "$bootstrap_dest"; then
    echo 'Multiple source directories exist; select one with WEIXIN_LINK_DIR.' >&2; exit 1
  fi
  bootstrap_dest="$HOME/.local/share/zero-link/source"
fi
if test "$#" -ne 0; then echo '用法：sh install.sh' >&2; exit 1; fi
if test -e "$bootstrap_dest" || test -L "$bootstrap_dest"; then
  if test -L "$bootstrap_dest" || ! test -d "$bootstrap_dest" || ! test -f "$bootstrap_dest/package.json" || { ! test -f "$bootstrap_dest/src/setup/account-manager.mjs" && ! test -f "$bootstrap_dest/src/wechat/account-manager.mjs"; } || ! test -f "$bootstrap_dest/src/setup/setup.mjs"; then
    echo "Installation directory already exists but is not a supported installation: $bootstrap_dest" >&2; exit 1
  fi
  bootstrap_node="$HOME/.local/share/wechat-ping-bot/tools/node/bin/node"
  if ! test -x "$bootstrap_node"; then bootstrap_node=$(command -v node || true); fi
  if test -z "$bootstrap_node" || ! "$bootstrap_node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
    echo 'Existing installation needs Node.js 24+ before upgrading.' >&2; exit 1
  fi
  "$bootstrap_node" -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));if(!["weixin-link","wechat-ping-bot"].includes(p.name))process.exit(1)' "$bootstrap_dest/package.json" || { echo 'Unrecognized existing source directory.' >&2; exit 1; }
  bootstrap_mode=upgrade
else
  bootstrap_mode=install
  case "$(uname -s)" in
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        bootstrap_fragment=$(systemctl --user show wechat-ping-bot.service --property=FragmentPath 2>/dev/null | sed -n 's/^FragmentPath=//p' || true)
        if test -n "$bootstrap_fragment"; then
          echo '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。' >&2; exit 1
        fi
      fi
      ;;
    Darwin)
      if launchctl print "gui/$(id -u)/com.wechat-assistant.wechat-ping-bot" >/dev/null 2>&1; then
        echo '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。' >&2; exit 1
      fi
      ;;
  esac
fi
for bootstrap_cmd in curl tar mktemp; do
  command -v "$bootstrap_cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $bootstrap_cmd" >&2; exit 1; }
done
bootstrap_ref="${WEIXIN_LINK_REF:-${ZERO_LINK_REF:-latest}}"
if test "$bootstrap_ref" = latest; then
  bootstrap_url=$(curl -fsSL --proto '=https' --tlsv1.2 -o /dev/null -w '%{url_effective}' https://github.com/zhangjingwei/weixin-link/releases/latest) || { echo 'No stable release available.' >&2; exit 1; }
  bootstrap_ref=${bootstrap_url##*/}
  printf '%s\n' "$bootstrap_ref" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || { echo 'No stable release available.' >&2; exit 1; }
fi
bootstrap_stable=false
if printf '%s\n' "$bootstrap_ref" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then bootstrap_stable=true; fi
bootstrap_expected="${WEIXIN_LINK_EXPECTED_COMMIT:-}"
if test -n "$bootstrap_expected"; then
  if test "${#bootstrap_expected}" -ne 40; then echo 'Invalid expected commit.' >&2; exit 1; fi
  case "$bootstrap_expected" in *[!0-9a-f]*) echo 'Invalid expected commit.' >&2; exit 1;; esac
fi
bootstrap_download_ref="${bootstrap_expected:-$bootstrap_ref}"
mkdir -p "$(dirname -- "$bootstrap_dest")"
bootstrap_tmp=$(mktemp -d "$(dirname -- "$bootstrap_dest")/.weixin-link-download.XXXXXX")
trap 'rm -rf -- "$bootstrap_tmp"' EXIT
curl -fSL --proto '=https' --tlsv1.2 \
  "https://api.github.com/repos/zhangjingwei/weixin-link/tarball/$bootstrap_download_ref" -o "$bootstrap_tmp/source.tar.gz"
mkdir "$bootstrap_tmp/source"
tar -xzf "$bootstrap_tmp/source.tar.gz" -C "$bootstrap_tmp/source" --strip-components=1
test -f "$bootstrap_tmp/source/src/setup/unix-install.sh" && test -f "$bootstrap_tmp/source/package.json" || {
  echo 'Downloaded archive is missing installation files.' >&2; exit 1;
}
bootstrap_archive_root=$(tar -tzf "$bootstrap_tmp/source.tar.gz" | sed -n '1p')
bootstrap_commit=$(printf '%s\n' "$bootstrap_archive_root" | sed -nE 's@^zhangjingwei-weixin-link-([0-9a-f]{7,40})/$@\1@p')
if test -n "$bootstrap_expected"; then
  if test -z "$bootstrap_commit"; then echo 'Downloaded commit could not be verified.' >&2; exit 1; fi
  case "$bootstrap_expected" in "$bootstrap_commit"*) ;; *) echo 'Downloaded commit differs from requested commit.' >&2; exit 1;; esac
fi
if test "$bootstrap_stable" = true; then
  bootstrap_version=$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$bootstrap_tmp/source/package.json")
  test "v$bootstrap_version" = "$bootstrap_ref" || { echo 'Release tag and package version differ.' >&2; exit 1; }
fi
if { test "$bootstrap_ref" = main || test "$bootstrap_stable" = true; } && test -n "$bootstrap_commit"; then
  printf '{"version":1,"repository":"zhangjingwei/weixin-link","ref":"%s","commit":"%s"}\n' "$bootstrap_ref" "$bootstrap_commit" > "$bootstrap_tmp/source/.weixin-link-release.json"
fi
if test "$bootstrap_mode" = upgrade; then
  test -f "$bootstrap_tmp/source/src/setup/upgrade.mjs" || { echo '该版本不支持升级。' >&2; exit 1; }
  echo '下载升级版本完成，正在检查已安装服务…'
  "$bootstrap_node" "$bootstrap_tmp/source/src/setup/upgrade.mjs" "$bootstrap_dest"
  exit 0
fi
# Reserve destination without overwriting another installation.
mkdir "$bootstrap_dest"
cp -R "$bootstrap_tmp/source/." "$bootstrap_dest/"
cd "$bootstrap_dest"
/bin/sh ./src/setup/unix-install.sh
