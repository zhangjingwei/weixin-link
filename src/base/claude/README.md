# Claude 底座

`claude-rpc.mjs` 将官方 `claude -p --output-format stream-json` 的会话和结果映射到现有任务事件。每轮启动一个进程，使用官方 session ID 续接；停止发送 SIGINT 并等待进程退出。用户请求经标准输入传入，策略经账号私有临时文件传入，避免出现在进程参数中。收件、取消、投递与恢复仍由共享核心处理。

安装配置通过 `agentBackend: "claude"` 和 `claudeBinary` 的绝对路径选择。需要 Claude CLI 2.1.259 或更新版本，并由运行服务提供 Anthropic Console API 密钥 `ANTHROPIC_API_KEY`，或配置受支持的云提供商凭据。密钥不进入微信消息或安装 JSON；Claude 订阅登录不用于本接入。[CLI 参数](https://code.claude.com/docs/en/cli-reference)、[编程调用与认证](https://code.claude.com/docs/en/headless)、[产品认证要求](https://code.claude.com/docs/en/legal-and-compliance)。

适配器使用 `--bare` 和 `bypassPermissions`，不自动加载 Claude 本机的插件、MCP、CLAUDE.md 或自动记忆，也不会发起本地权限提示；实际文件和命令权限取决于服务账号的操作系统权限。微信策略和工作目录的 AGENTS.md 由接入层显式传入。Claude 会话和 `CLAUDE_CONFIG_DIR` 按微信账号隔离，不复用 Codex 会话 ID。模型目录、原生记忆开关、官方历史检索、远程归档和永久删除尚未接入；对应命令明确拒绝，不声称已完成。此实现已通过模拟 CLI 测试，仍需在有 CLI 与 API 凭据的隔离环境验收真实模型、重启续接和停止行为。
