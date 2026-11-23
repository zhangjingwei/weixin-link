# Changelog

## Unreleased

- Add a project-scoped model selection MCP tool for future turns, with model validation, durable preferences and isolated request deduplication.

## 1.7.0 — 2026-11-23

- 在一个微信入口向不同项目提交任务，保留各项目独立队列，并按项目和任务标注进展与结果。
- 扩展至 31 个管理 MCP 工具，支持自然语言查询服务、安装状态、诊断和使用帮助，以及归档项目。
- 通过自然语言安排账号重启和指定版本升级，沿用空闲检查与原有维护流程，并可查询维护状态。
- 日常说明与首次使用引导改为自然语言示例，保留停止、状态、安装帮助等应急命令参考。

## 1.6.0 — 2026-11-23

- Add 22 account-scoped management MCP tools and a bundled Skill for natural-language project and conversation management, with managed installation and removal.
- Preserve complete history through pagination and bounded search; bind task supplements, stops and reconciliation to the exact original task without replaying execution.
- Query results without resending files, and explicitly redeliver the original verified snapshot; isolate management quotas by user and clear private payloads when a request was not executed.
- Manage project-bound reminders and scheduled tasks, check releases and skip a specific version; cancelling a schedule does not stop tasks already submitted.
- Reduce false installation model-test timeouts with isolated probes, a three-minute limit and retries that preserve sign-in authorization; accept only an exact verified response.

Automated release, platform, and unit checks passed. Live WeChat messaging and other platforms were not verified for this release.

## 1.5.0 — 2026-11-11

- Preserve complete conversation history with readable pagination, and make daily conversation selection and switching notices clearer.
- Validate generated artifact delivery and keep temporary files private.
- Add explicit WeChat update checks and a saved choice to skip reminders for a specific release without hiding newer releases.
- Show maintained release highlights and version links in update notices and completed-upgrade messages.
- Include a short quick-start guide after first login and clarify Codex device-code authorization setup.

Automated release, platform, and unit checks passed. Live WeChat messaging and other platforms were not verified for this release.

## 1.4.1 — 2026-11-10

- Let the local Codex process inherit the service time zone instead of forcing `Asia/Shanghai`.
- Use the service's system time zone when guiding Codex to create recurring schedules, and clarify that one-time schedules need the offset for their target date.

Automated release, platform, Codex protocol, and schedule tests passed. Live WeChat messaging and other platforms were not verified for this patch.

## 1.4.0 — 2026-11-10

- Bundle the Codex CLI and configure model access per WeChat account through the terminal installer. Add Chinese and English setup and maintenance flows.
- Use the published WeChat SDK for PIN pairing. Preserve account data during interrupted installation, recognize an existing scanner during relinking, and distinguish pairing from service startup failures.
- Add guided conversation management and improve Codex session recovery, including a clear result when an old thread is absent from the current Codex store.
- Replace the removed Claude and OpenCode backends and remote Codex task path with the Codex backend and SSH host operations.
- Fix the model probe's stdin handling and suppress release notices when a branch installation has no official release commit.

Automated release, platform, and unit checks are required before publication. Live PIN pairing and new conversation messaging were confirmed on macOS during testing; other platforms have not been verified live for this release.

## 1.3.2 — 2026-11-10

- Allow `config-set remote-hosts` to save valid host entries while a host is offline. Connection failures are reported when that host is used; configuration writes no longer probe every host.
- Keep schema validation, existing remote task reconciliation, atomic writes, and runtime drain checks. The configuration response reports `verified: false` because connectivity was not checked.

Automated tests cover offline configuration writes and remote task safeguards. Live remote connections were not exercised for this patch.

## 1.3.1 — 2026-11-09

- Use `qr.sh` directly for the initial Linux/macOS pairing flow, including the existing same-terminal PIN prompt.
- Remove the redundant `wechat-setup` shell wrapper and document first login, login after an upgrade, and separate account profiles.

Automated installation and QR tests passed. Live pairing for this patch was not repeated; Windows installation is unchanged.

## 1.3.0 — 2026-11-09

- Switched to the independently published, pinned `wechatbot-zerolink` SDK and removed local SDK postinstall patches.
- Added Chinese WeChat controls for supported Codex session commands, including goals, reviews, model selection, and conversation management. Removed legacy slash aliases.
- Fixed review progress handling when Codex reports a nested turn, and clarified that saving a long-task goal does not start execution.
- Made local upgrades accept accounts awaiting WeChat login, verify stable startup before completion, and report progress through backup, code switch, and health checks.
- Added SDK PIN requests during pairing. The QR command now waits for the PIN challenge and accepts hidden PIN input in the same terminal, including a retry after rejection.

Live WeChat pairing with a PIN was verified on macOS. Automated tests cover the SDK request, PIN challenge, upgrade recovery, and native command behavior; other platforms still require live validation.
