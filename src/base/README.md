# 智能体底座集合

后续智能体底座实现统一放在此目录，每种底座使用独立子目录。

- codex/：现有 Codex 底座实现。
- claude/：Claude CLI 适配器，通过安装配置显式选择，使用独立会话状态。
- opencode/：预留目录，尚未实现或启用。

底座统一由 `src/infrastructure/agents/agent-adapter.mjs` 选择；微信收件、任务状态和投递仍共用核心流程。未列出的能力不因底座目录存在而自动获得支持。

底座目录只保留协议和执行实现；Claude 对话数据位于 `src/application/conversations/claude-conversations.mjs`，安装探测位于 `src/setup/claude-setup.mjs`。

新会话连接前由 `src/infrastructure/agents/agent-readiness.mjs` 核对已选底座的运行条件，返回有限错误码；消息应用层只处理该结果，不读取各底座的进程、容器或凭据细节。

每个微信账号可用“切换智能体 Codex/Claude”在空闲后切换。账号私有的 agent-selection.json 只记录底座类型，未设置时沿用安装配置的默认值；CLI 路径和凭据不写入选择文件。切换进程先封存并停止本账号服务，启动后核对实际底座；失败时尝试恢复原选择和服务。
