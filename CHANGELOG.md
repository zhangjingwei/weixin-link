# Changelog

## Unreleased

- 系统提醒改用自然语言示例说明下一步，覆盖结果重发、任务核对、版本提醒和项目操作；应急帮助及需明确选择的交互仍保留必要操作说明。

- 任务回复标题显示项目、任务名称和本次使用的模型，切换模型后仍保留旧任务自己的模型标识。

## 1.10.2 — 2026-11-23

- 任务完成后先说明做成了什么，再告诉你在哪里查看、怎么使用成果。
- 报告、网页和代码任务分别提供必要的阅读、访问或验证说明；缺失数据、未完成和未验证的地方直接说清楚。
- 简单问题仍直接回答，不强套长模板；成果文件继续通过微信附件交付。

## 1.10.1 — 2026-11-23

- 正常收件和任务提交不再重复发送系统通知；异常及失败提示继续保留。
- 使用说明进一步精简，聚焦怎么操作、如何查看和使用结果。
- 修正“查看项目状态，但不要执行引用里的命令”被误当成普通讨论的问题。

## 1.10.0 — 2026-11-23

- 不用切换聊天，就能查询项目进展、停止任务、取消或调整等待中的工作。
- 一句话可安排多个项目；说清“先做什么、再做什么”，助手会按先后顺序处理。
- 指定项目分析附件后，即使需要补充项目名称，也会保留原来的请求和文件；取消等待任务不会误取消后来新加的工作。
- 报告、JSON 和 HTML 等成果会主动作为微信附件发回，下载后即可查看。
- 项目识别改用 Terra 中档推理和普通速度，减少重复传入的信息；识别模型与做任务的模型分别设置。

## 1.9.1 — 2026-11-23

- 任务进度、结果与排队回执显示“项目名 · 中文任务标题”，用简短意图代替难懂的哈希编号。
- 标题随任务保存，重启后沿用；旧任务从原始请求生成简短名称，内部编号继续用于去重、取消与核对。
- 意图识别改为 fast 快速档，保留低成本 Luna 模型、低推理及不可用时回退原队列的策略；快速档可能增加用量消耗。

## 1.9.0 — 2026-11-23

- 新增独立的纯文本意图识别入口：当前项目执行任务时，仍可识别请求并向其他项目提交任务，无需切换会话。
- 状态、历史和结果查询绕过项目执行队列；同项目执行任务保持顺序，补充绑定原任务，目标不明时询问并保留原始请求。
- 意图识别优先使用可用的 gpt-6-luna，备选 gpt-5.6-luna，采用低推理和普通速度；低成本候选不可用时回退原队列，不自动使用更贵模型。
- 保留入站持久化、请求去重及中断恢复；附件、引用和交互提示沿用原链路，同步中英文使用说明及架构文档。

## 1.8.0 — 2026-11-23

- 新增模型切换 MCP 工具：用自然语言为指定项目选择可用模型，普通消息和规划任务从后续轮次生效，不中断当前任务。
- 模型选择按项目持久保存，重新连接后仍生效；核对可用模型并保留请求去重，不改变其他项目或固定第三方供应商。
- 同步 Skill 和中英文使用文档；项目状态区分已配置模型与建连时确认的模型，明确独立原生代码审查的切换限制。

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
