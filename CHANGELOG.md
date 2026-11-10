# Changelog

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
