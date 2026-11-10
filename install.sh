#!/bin/sh
# Install or upgrade a standard Weixin Link deployment from one shell entry.
set -eu
umask 077
case "${WEIXIN_LINK_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in en*) bootstrap_english=1;; *) bootstrap_english=0;; esac
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
test "$#" -eq 0 || { echo 'Usage: sh install.sh' >&2; exit 1; }
bootstrap_command=install
bootstrap_account=default
bootstrap_run_interactive() {
  if test -t 0; then "$@"
  elif ( : </dev/tty ) 2>/dev/null; then "$@" </dev/tty
  else "$@"
  fi
}
bootstrap_select() (
  bootstrap_title=$1 bootstrap_selected=$2
  shift 2
  bootstrap_count=$#
  bootstrap_tty_state=$(stty -g </dev/tty) || exit 1
  stty -echo -icanon min 1 time 0 </dev/tty
  trap 'stty "$bootstrap_tty_state" </dev/tty 2>/dev/null || true' EXIT
  trap 'exit 130' INT TERM HUP
  bootstrap_draw() {
    bootstrap_index=1
    for bootstrap_label do
      if test "$bootstrap_index" -eq "$bootstrap_selected"; then
        printf '\033[2K> %s\n' "$bootstrap_label" >/dev/tty
      else
        printf '\033[2K  %s\n' "$bootstrap_label" >/dev/tty
      fi
      bootstrap_index=$((bootstrap_index + 1))
    done
  }
  printf '\n%s\n' "$bootstrap_title" >/dev/tty
  bootstrap_draw "$@"
  while :; do
    bootstrap_key=$(dd bs=1 count=1 2>/dev/null </dev/tty)
    case "$bootstrap_key" in
      ''|"$(printf '\r')") printf '%s\n' "$bootstrap_selected"; exit 0 ;;
      "$(printf '\033')")
        bootstrap_key=$(dd bs=1 count=1 2>/dev/null </dev/tty)
        if test "$bootstrap_key" = '['; then
          bootstrap_key=$(dd bs=1 count=1 2>/dev/null </dev/tty)
          case "$bootstrap_key" in
            A) bootstrap_selected=$((bootstrap_selected - 1)); test "$bootstrap_selected" -ge 1 || bootstrap_selected=$bootstrap_count ;;
            B) bootstrap_selected=$((bootstrap_selected + 1)); test "$bootstrap_selected" -le "$bootstrap_count" || bootstrap_selected=1 ;;
          esac
        fi ;;
      [1-9]) if test "$bootstrap_key" -le "$bootstrap_count"; then bootstrap_selected=$bootstrap_key; else continue; fi ;;
      0) if test "$bootstrap_count" -eq 6; then bootstrap_selected=6; else continue; fi ;;
      *) continue ;;
    esac
    printf '\033[%sA' "$bootstrap_count" >/dev/tty
    bootstrap_draw "$@"
  done
)
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
  if test -f "$bootstrap_dest/.weixin-link-install-pending" || { test -z "${WEIXIN_LINK_DIR:-}${ZERO_LINK_DIR:-}" && test "$bootstrap_dest" = "$HOME/.local/share/weixin-link/source" && ! test -d "$bootstrap_dest/node_modules/proper-lockfile" && ! test -f "$HOME/.local/share/wechat-ping-bot/installation.json" && ! test -e "$bootstrap_dest/.git"; }; then
    bootstrap_service_found=false
    case "$(uname -s)" in
      Linux) if command -v systemctl >/dev/null 2>&1 && systemctl --user show wechat-ping-bot.service --property=FragmentPath 2>/dev/null | grep -q '^FragmentPath=.'; then bootstrap_service_found=true; fi ;;
      Darwin) if launchctl print "gui/$(id -u)/com.wechat-assistant.wechat-ping-bot" >/dev/null 2>&1; then bootstrap_service_found=true; fi ;;
    esac
    if test "$bootstrap_service_found" = false; then bootstrap_mode=resume; fi
  fi
  if test "$bootstrap_mode" = upgrade && ( : </dev/tty ) 2>/dev/null; then
    if test "$bootstrap_english" = 1; then
      bootstrap_choice=$(bootstrap_select 'Use ↑/↓ to choose, then press Enter:' 1 'Upgrade' 'Configure model' 'Log in to WeChat again' 'Add WeChat account' 'Uninstall' 'Exit')
    else
      bootstrap_choice=$(bootstrap_select '用 ↑/↓ 选择，回车确认：' 1 '升级' '配置模型' '重新登录微信' '添加微信账号' '卸载' '退出')
    fi
    case "$bootstrap_choice" in
      1) ;;
      2) bootstrap_command=setup; bootstrap_mode=maintenance ;;
      3) bootstrap_command=relogin; bootstrap_mode=maintenance ;;
      4)
        bootstrap_command=account-create; bootstrap_mode=maintenance
        if test "$bootstrap_english" = 1; then printf 'New account name (lowercase letters, digits, hyphens): ' >/dev/tty; else printf '新账号名称（小写字母、数字、连字符）：' >/dev/tty; fi
        IFS= read -r bootstrap_account </dev/tty || exit 1
        ;;
      5)
        bootstrap_command=uninstall; bootstrap_mode=maintenance
        if test "$bootstrap_english" = 1; then
          bootstrap_confirm=$(bootstrap_select 'Uninstall the program? Account data and workspace will be kept.' 1 'Cancel' 'Confirm uninstall')
        else
          bootstrap_confirm=$(bootstrap_select '卸载程序？账号数据和工作区会保留。' 1 '取消' '确认卸载')
        fi
        test "$bootstrap_confirm" = 2 || exit 0
        ;;
      6) exit 0 ;;
      *) echo 'INVALID_INSTALL_CHOICE' >&2; exit 1 ;;
    esac
  fi
else
  bootstrap_mode=install
  case "$(uname -s)" in
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        bootstrap_fragment=$(systemctl --user show wechat-ping-bot.service --property=FragmentPath 2>/dev/null | sed -n 's/^FragmentPath=//p' || true)
        if test -n "$bootstrap_fragment"; then
          if test "$bootstrap_english" = 1; then echo 'A background service exists but the selected source directory is missing. Set WEIXIN_LINK_DIR to the original source; no new installation was created.' >&2; else echo '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。' >&2; fi; exit 1
        fi
      fi
      ;;
    Darwin)
      if launchctl print "gui/$(id -u)/com.wechat-assistant.wechat-ping-bot" >/dev/null 2>&1; then
        if test "$bootstrap_english" = 1; then echo 'A background service exists but the selected source directory is missing. Set WEIXIN_LINK_DIR to the original source; no new installation was created.' >&2; else echo '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。' >&2; fi; exit 1
      fi
      ;;
  esac
fi
if test "$bootstrap_mode" = resume; then
  PATH="$(dirname "$bootstrap_node"):$PATH"; export PATH
  cd "$bootstrap_dest"
  if ! test -d node_modules/proper-lockfile; then npm ci; fi
  bootstrap_run_interactive /bin/sh ./src/setup/unix-install.sh
  rm -f .weixin-link-install-pending
  exit 0
fi
if test "$bootstrap_mode" = maintenance; then
  if ! test -f "$bootstrap_dest/src/setup/account-manager.mjs"; then if test "$bootstrap_english" = 1; then echo 'Upgrade this installation before using the menu.' >&2; else echo '请先升级当前安装版本，再使用菜单。' >&2; fi; exit 1; fi
  PATH="$(dirname "$bootstrap_node"):$PATH"; export PATH
  cd "$bootstrap_dest"
  case "$bootstrap_command" in
   setup) bootstrap_run_interactive "$bootstrap_node" src/setup/setup.mjs wizard "$bootstrap_account" --human ;;
   relogin) bootstrap_run_interactive "$bootstrap_node" src/setup/setup.mjs wechat-login --relogin "$bootstrap_account" --human ;;
   account-create) "$bootstrap_node" src/setup/account-manager.mjs create "$bootstrap_account" --human; bootstrap_run_interactive "$bootstrap_node" src/setup/setup.mjs wizard "$bootstrap_account" --human; bootstrap_run_interactive "$bootstrap_node" src/setup/setup.mjs wechat-login "$bootstrap_account" --human ;;
   uninstall)
     test ! -e .git || { echo 'UNINSTALL_SOURCE_REQUIRES_REVIEW' >&2; exit 1; }
     bootstrap_has_service=false
     case "$(uname -s)" in
       Darwin)
         for bootstrap_file in "$HOME"/Library/LaunchAgents/com.wechat-assistant.wechat-ping-bot*.plist "$HOME"/Library/LaunchAgents/com.wechat-assistant.wechat-pair-*.plist; do
           if test -e "$bootstrap_file" || test -L "$bootstrap_file"; then bootstrap_has_service=true; fi
         done
         if launchctl list 2>/dev/null | grep -Eq 'com\.wechat-assistant\.(wechat-ping-bot|wechat-pair-)'; then bootstrap_has_service=true; fi
         ;;
       Linux)
         for bootstrap_file in "$HOME"/.config/systemd/user/wechat-ping-bot.service "$HOME"/.config/systemd/user/wechat-ping-bot@.service; do
           if test -e "$bootstrap_file" || test -L "$bootstrap_file"; then bootstrap_has_service=true; fi
         done
         if systemctl --user list-units --all --plain --no-legend 'wechat-ping-bot*.service' 'wechat-pair-*.service' 2>/dev/null | grep -q 'wechat-'; then bootstrap_has_service=true; fi
         ;;
     esac
     if test "$bootstrap_has_service" = true; then
       test -f src/setup/uninstall.mjs || { echo '请先升级当前安装版本，再使用卸载菜单。' >&2; exit 1; }
       "$bootstrap_node" src/setup/uninstall.mjs
     fi
     bootstrap_target=$(pwd -P)
     case "$bootstrap_target" in /|"$HOME") echo 'INVALID_INSTALLATION_DIR' >&2; exit 1;; esac
     cd "$(dirname -- "$bootstrap_target")"
     rm -rf -- "$bootstrap_target"
     echo '程序已卸载，账号数据和工作区已保留。'
     ;;
  esac
  exit 0
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
  test -f "$bootstrap_tmp/source/src/setup/upgrade.mjs" || { if test "$bootstrap_english" = 1; then echo 'This release does not support upgrades.' >&2; else echo '该版本不支持升级。' >&2; fi; exit 1; }
  if test "$bootstrap_english" = 1; then echo 'Upgrade source downloaded. Checking the installed service…'; else echo '下载升级版本完成，正在检查已安装服务…'; fi
  "$bootstrap_node" "$bootstrap_tmp/source/src/setup/upgrade.mjs" "$bootstrap_dest"
  exit 0
fi
# Reserve destination without overwriting another installation.
mkdir "$bootstrap_dest"
cp -R "$bootstrap_tmp/source/." "$bootstrap_dest/"
cd "$bootstrap_dest"
touch .weixin-link-install-pending
bootstrap_run_interactive /bin/sh ./src/setup/unix-install.sh
rm -f .weixin-link-install-pending
