# Doubao / Grok 官方 CLI 接入

Doubao 和 Grok 作为独立智能体接入，同一逻辑对话分别保存各自原生会话。切换由当前智能体理解自然语言，再调用管理 MCP；没有新增固定文字命令。不把两者作为 Codex 的模型别名，不迁移供应商内部推理。

## 已适配版本与接口

| 智能体 | 官方 CLI | 固定版本 | 启动协议 |
| --- | --- | --- | --- |
| Doubao（豆包） | `@bytedance/doubao-cli`，命令 `doubao` | 2.38.2 | `doubao acp serve`，ACP v1 |
| Grok | `@xai-official/grok`，命令 `grok` | 1.0.92 | `grok --no-auto-update agent stdio`，ACP v1 |

版本不匹配会拒绝连接。不要将第三方同名 `doubao-cli`、豆包插件开发工具 `dbx` 或模型 API 当作上述执行器。

## 安装与使用

由用户通过官方渠道安装对应 CLI，并在主机完成官方登录：

```sh
doubao login
grok login
```

更新 Weixin Link 后启动服务，服务自动发现其 PATH 中版本符合要求的 `doubao` / `grok`，加入可切换列表。不会自动安装 CLI、登录或切换已有对话。若安装路径不在服务 PATH 中，先停止服务，再在源码目录登记绝对路径：

```sh
node src/setup/agent.mjs configure doubao --binary /absolute/path/to/doubao
node src/setup/agent.mjs configure grok --binary /absolute/path/to/grok
```

新会话在微信中选择执行器。服务在线时拒绝修改这些配置，命令不代为启动或重启。

启动服务后，微信示例：

- “查询当前对话使用的智能体和可用智能体，先不要切换。”
- “切到豆包，读取 package.json，告诉我测试命令，不修改文件。”
- “换 Grok，核对刚才给出的测试命令，不修改文件。”
- “切回 Codex，继续检查刚才的结果。”

通过 `get_conversation_agents` 查看 activeAgent 与 availableAgents，再由 `request_agent_switch` 提交切换后的具体任务。工具标识分别为 `doubao` / `grok`。queued 仅表示持久入队；源任务确认成功结束后才释放后续任务，不重跑源任务。

## 状态与能力边界

- 新选择先建立原生会话再保存；初始化、认证或恢复失败时恢复原选择。重启和切回按原 ID 恢复，不按最近目录猜测，也不自动新建替代会话。
- Grok 仅使用初始化公告的 `cached_token` 认证，不调用交互登录认证方法。未公告缓存登录时提示用户在主机登录。Doubao 使用官方 CLI 自身登录检查。不复制令牌，不向 CLI 注入 API Key 或继承模型服务密钥环境变量；CLI 本身的模型和计费配置仍由用户管理。
- 管理 MCP 通过当前会话参数传入，capability 只出现在该 MCP 的环境中。共享 ACP 代码负责分帧、审批、取消、事件和结果，启动参数及认证仍由各供应商适配负责。
- 平台指令作为每轮 ACP 输入的独立文本块传入；未假设供应商支持额外的系统提示命令行参数。
- 文本可用；PNG/JPEG 图片还须执行器明确公告图片能力，未公告则拒绝，不伪装成已上传。音频和执行中补充暂不支持。模型列表来自原生公告，不编造模型名。
- 审批只接受原协议提供的单次选项，不自动授予永久权限。停止请求不等于已停止；连接丢失、未知结束原因保持未知，不自动重发。
- `end_turn` 表示轮次正常结束，业务完成仍需所属任务的结构化回执；微信收到与执行完成分别记录。Codex 原生项目、归档、删除、记忆和桌面接续协议不发送给这些执行器。

## 验证

```sh
node --test tests/agents/*.test.mjs tests/management/*.test.mjs tests/domain/*.test.mjs
npm run check:codex-contract
```

测试覆盖官方命令参数、固定版本、环境过滤、ACP 事件、会话恢复、审批、取消、未知结果、自动发现、注册、真实 MCP stdio 与私有控制端点、持久队列接续、重启恢复和切回 Codex。智能体执行由模拟协议提供；不是模型理解自然语言或真实账号推理验收。

macOS ARM64 下，Grok 1.0.92 在隔离 HOME 完成 ACP v1 initialize，公告 loadSession 与图片能力。Doubao 2.38.2 的原版帮助确认 ACP 接口；隔离 HOME 中安全存储不可用，未完成真实 ACP 握手。未执行真实登录、模型推理、微信发送或 Windows/Linux 实机验收。

参考：[Grok 官方 ACP 文档](https://docs.x.ai/build/cli/headless-scripting)、[Grok 官方认证实现](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs)、[豆包官方 CLI 包说明](https://www.npmjs.com/package/@bytedance/doubao-cli)。豆包接口同时以固定版本原版 `--help` 为依据。
