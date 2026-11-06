#!/bin/sh
set -eu
report="$HOME/.local/share/wechat-ping-bot/media-deployment-status.txt"
systemctl --user restart wechat-ping-bot.service
sleep 5
if systemctl --user is-active --quiet wechat-ping-bot.service; then
  printf 'media code deployed; service active\n' > "$report"
else
  cp "$HOME/wechat-ping-bot/backups/before-media/bot.mjs" "$HOME/wechat-ping-bot/bot.mjs"
  cp "$HOME/wechat-ping-bot/backups/before-media/codex-session.mjs" "$HOME/wechat-ping-bot/codex-session.mjs"
  systemctl --user restart wechat-ping-bot.service
  printf 'media deployment failed; reverted entrypoint and session code\n' > "$report"
fi
