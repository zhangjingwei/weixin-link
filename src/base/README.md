# Codex 底座

`codex/` 包含官方 Codex CLI app-server 的协议客户端与执行实现。微信收件、持久任务、会话选择和投递由接入层负责；`src/infrastructure/agents/` 将 Codex 能力接入这些用例。

新会话连接前由 `src/infrastructure/agents/agent-readiness.mjs` 检查本机 CLI 或已绑定容器的运行条件。安装、登录和推理验收由 `src/setup/` 处理。
