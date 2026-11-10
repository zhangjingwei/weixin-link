# Changelog

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
