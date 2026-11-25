#!/bin/sh
# Fresh installation only. Never invoke the update or relogin entry points.
set -eu
umask 077
base="$HOME/.local/share"
dest="$base/weixin-link/source"
state="$base/wechat-ping-bot"
marker="$dest/.mac-first-install"
resources=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exists(){ test -e "$1" || test -L "$1"; }
for path in "$base/zero-link/source"; do exists "$path" && exit 41; done
mkdir -p "$base/weixin-link"
lock="$base/weixin-link/.mac-setup.lock"
mkdir "$lock" || exit 42
trap 'rmdir "$lock"' EXIT
if ! exists "$dest"; then
 for path in "$state" "$HOME"/Library/LaunchAgents/com.wechat-assistant.wechat-*.plist; do exists "$path" && exit 41; done
 if launchctl print "gui/$(id -u)/com.wechat-assistant.wechat-ping-bot" >/dev/null 2>&1; then exit 41; fi
 # Validate the full archive before reserving the final directory.
 staging=$(mktemp -d "$base/weixin-link/.first-source.XXXXXX")
 trap 'rm -rf "$staging"; rmdir "$lock"' EXIT
 /usr/bin/tar -xzf "$resources/service.tar.gz" -C "$staging"
 touch "$staging/.mac-first-install"
 mkdir "$dest"; /bin/cp -R "$staging/." "$dest/"
else
 test ! -L "$dest" && test -f "$marker" && test ! -L "$marker" || exit 41
fi
# On an interrupted first setup, resume only our reserved tree, never replace it.
test -f "$dest/src/setup/unix-install.sh" || exit 43
WEIXIN_LINK_MAC_FIRST_SETUP=1 /bin/sh "$dest/src/setup/unix-install.sh" </dev/null
rm "$marker"
