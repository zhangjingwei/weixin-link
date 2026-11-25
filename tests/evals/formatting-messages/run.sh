#!/usr/bin/env bash
set -eu
suite="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$suite/../../.." && pwd)"
run_dir="$(mktemp -d "${TMPDIR:-/tmp}/wechat-format-eval.XXXXXX")"
echo "评测目录 $run_dir"
cd "$run_dir"
mkdir -p skills evals/formatting-messages/fixtures
cp -R "$root/src/infrastructure/agents/skills/formatting-messages" skills/
cp -R "$suite/tasks" "$suite/eval.yaml" evals/formatting-messages/
spec=evals/formatting-messages/eval.yaml
waza preflight "$spec"
# 分开保存两组，便于逐次核对原始回复。
status=0
for arm in with-skill without-skill; do
  args=(--no-cache --parallel --workers 2)
  if [[ "$arm" == without-skill ]]; then args+=(--no-skills); fi
  waza run "$spec" "${args[@]}" \
    --output "$arm.json" || status=$?
done
node "$suite/check-output.mjs" with-skill.json without-skill.json || status=$?
exit "$status"
