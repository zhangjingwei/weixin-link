#!/bin/sh
set -eu
umask 077
usage() { echo '用法：./upgrade-local.sh [--http | --auto] [--staged] [--check] [--details]'; }
transport=
staged=false
check=false
details=false
for arg do
  case "$arg" in
    --http|--auto)
      mode=${arg#--}
      if [ -n "$transport" ] && [ "$transport" != "$mode" ]; then usage >&2; exit 2; fi
      transport=$mode ;;
    --staged) staged=true ;;
    --details) details=true ;;
    --check) check=true ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"
# A private index freezes the preview and preserves partial staging in the real index.
tree=$(git write-tree)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
trap 'exit 1' HUP INT TERM
export GIT_INDEX_FILE="$scratch/index"
git read-tree "$tree"
if [ "$staged" = false ]; then
  git add -A -- .
  echo '本地试用 · 当前工作目录'
else
  echo '本地试用 · 已暂存的改动'
fi
if [ -n "$transport" ]; then
  config=src/base/codex/subscription-transport.json
  git ls-files --error-unmatch -- "$config" >/dev/null || { echo '所选快照尚不支持选择订阅连接方式。' >&2; exit 1; }
  blob=$(printf '"%s"\n' "$transport" | git hash-object -w --stdin)
  git update-index --cacheinfo "100644,$blob,$config"
  echo "Codex 订阅连接：$transport"
fi
if [ "$details" = true ] || [ "$check" = true ]; then
  git --no-pager diff --cached --stat HEAD
fi
set --
if [ "$check" = true ]; then set -- --check; fi
if [ "$details" = true ]; then set -- "$@" --details; fi
node src/tools/upgrade-local.mjs "$@"
