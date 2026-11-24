# Codex 底座

`codex/` 包含官方 Codex CLI app-server 的协议客户端与执行实现。微信收件、持久任务、会话选择和投递由接入层负责；`src/infrastructure/agents/` 将 Codex 能力接入这些用例。

微信消息入队后，任务使用实际的 Codex app-server 连接建立会话。安装、登录和推理验收由 `src/setup/` 处理。
