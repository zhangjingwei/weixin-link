# Claude Code CLI 接入与同对话切换

Codex 仍是默认底座。Claude Code 是显式选择的可选适配，使用用户自己的官方订阅登录及未修改的本机 CLI。当前验证组合为 Claude Code 2.1.319 与 `@anthropic-ai/claude-agent-sdk` 0.3.319；其他版本会拒绝启动，需要重新验证后更新适配，避免静默使用不同协议。

## 配置与试用

以下操作由用户在源码目录执行，不会自动安装或升级当前服务。先安装本版本依赖 `npm ci`，再通过官方渠道安装对应版本 CLI。将示例路径替换成实际的 Claude Code 绝对路径。

```sh
# 登录由原版 CLI 完成，不在微信或自制表单收集密码。
node src/setup/agent.mjs login claude --binary /absolute/path/to/claude

# 查询当前选择。
node src/setup/agent.mjs status

# 先停止本机 Weixin Link 服务，再注册可切换底座（保持 Codex 默认）。
node src/setup/agent.mjs configure claude --binary /absolute/path/to/claude

# 以下选择改变实例默认底座及其历史数据根，通常无需使用。服务在线时命令会拒绝。
node src/setup/agent.mjs select claude --binary /absolute/path/to/claude

# 启动服务后，新消息使用 Claude；切回前同样先停止服务。
node src/setup/agent.mjs select codex
```

选择命令只保存私有 `agent.json`，不代为停止、启动、重启服务。它会检查 CLI 版本和登录类型，只接受 `claude.ai` 登录；不会读取或复制 OAuth token。宿主传给 CLI 的环境会去除 Anthropic API Key、订阅 token 和云提供商路由变量，启动握手还会核对报告的 API 来源，避免意外切换计费方式。用户配置的工具权限继续由官方 CLI 执行。

## 数据与接续边界

同一条微信/Mac 逻辑对话可以分别关联 Codex 和 Claude Code 原生会话。注册 Claude 后，在微信明确说“换 Claude Code，接着核实刚才的实现”；模型通过 `get_conversation_agents` 查询，再用 `request_agent_switch` 提交带用户要求的持久后续任务。切回 Codex 时恢复该对话原来的 Codex ID，不创建替代会话。

正在执行的源任务不会被中断或重跑；接续任务依赖源任务确认成功结束。源任务失败、取消、等待附件或状态不明时不会自动启动目标。有其他排队任务或待审批时拒绝新的交接。每条已入队任务固定其底座；交接后收到的普通消息沿用已排队的目标底座。queued 只是入队，实际底座和任务状态可继续查询，不能宣称切换或执行成功。

交接使用本对话最近真实用户消息、最近四份结果与已授权附件引用，长度有界；不复制供应商内部推理或冒充已迁移全部原生历史。用户对原方案的批评由交接请求保留，旧模型的结论只是待核实历史。新底座应重新检查工作区和证据。切回也传递交接资料。

旧实例默认选择与数据根保持兼容：Codex 使用原账号数据目录，原来以 Claude 作为实例默认底座的安装仍使用 `agents/claude/`。不会自动合并两个历史数据根。每个数据根中的一条逻辑对话可保存多个底座关联，旧 `threadId` 字段保留为当前关联的兼容投影。注册或选择命令不会自动停止、启动或升级服务；手动更新并重启后生效。

Claude 原生会话 ID 作为不透明 ID 保存，并记录 `agentKind=claude`，不会填入 Codex 原生项目 ID。历史由 CLI 原生会话持久化；重启使用明确的 ID 恢复，不能按最近工作目录猜测。若崩溃发生在提交和结果保存之间，任务保持未确认，不能仅凭助手文字推断成功，也不会自动重跑。已保存的结果仍从既有结果记录恢复。

Mac 与微信沿用同一收件和投递逻辑。Mac 可只读查看当前 Claude 会话、消息、附件与任务进展；显式接手规则不变。Mac 按逻辑对话汇总双方原有消息和结果，保留各自原生会话身份；切换不抢占 Mac/微信操作权。Claude 专属的原生项目浏览和 Claude Desktop 接续不在首版范围。

## 能力

- 文字及预处理后的 PNG/JPEG 图片通过流式 SDK 输入进入原会话。PDF、Office、音视频仍按现有附件处理链提取和授权；原生音频输入明确拒绝。
- 主回答由原生 `result` 事件收束；增量和子智能体文本不作为最终回答发送。进程退出而没有权威结果时保持未知状态。
- `canUseTool` 和 `AskUserQuestion` 映射到既有审批、提问与超时流程。批准只作用于原会话的原请求；关闭、取消、超时均拒绝尚未解决的审批。
- 停止调用 SDK `interrupt()`；控制回应只说明请求已发出，必须等待终态。连接丢失不会自动报告已停止。
- 不支持 Codex 原生队列、goal、原生项目管理、执行中补充、跨原生会话恢复命令及 Codex 桌面接续。新的普通消息沿用本地持久队列，等待上一任务结束；明确的“补充”请求会说明尚未支持，不谎报已提交。
- 首版关闭后台 Agent、Monitor、计划唤醒等工具及 Claude 后台任务，避免把前台回答结束当作后台工作全部完成。
- 未向 Claude 装配 Codex 管理 MCP；本机管理接口和明确的停止/审批仍由宿主处理。跨项目自然语言派发及专属技能加载需要后续适配，不宣称与 Codex 完全等价。

## 验证

```sh
node --test tests/agents/claude-session.test.mjs
node --test tests/domain/layer-dependencies.test.mjs
npm test
```

自动化使用隔离数据和模拟 SDK 事件，覆盖多轮、图片、原会话恢复、审批归属、停止、异常和选择限制。实际 CLI/SDK 初始化可以在隔离 HOME 下进行，不需要发送模型消息。真实订阅推理、真实图片理解和微信端到端收发须在专门授权的验收环境另外验证，不能用初始化成功替代。
