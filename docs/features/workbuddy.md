# WorkBuddy 接入（CodeBuddy CLI / ACP）

接入腾讯官方 CodeBuddy Code CLI 的公开 ACP stdio 接口，使用用户自己的官方账号。当前验证版本为 `@tencent-ai/codebuddy-code` **2.187.0**，不使用 WorkBuddy 桌面内部 RPC、不复制登录凭据、不采用 API Key 回退。桌面登录与 CLI 登录能否共用不能据此保证，须以 CLI 实际登录及请求结果为准。版本不匹配会拒绝启动。

## 自动发现与手动配置

服务启动时会查找服务进程 PATH 中的 `codebuddy`，版本符合要求后将 WorkBuddy 加入本次运行的可切换列表，无需先运行 `configure`。每次启动重新发现，不写入 `agent.json`，已有对话保留自己的选择。手动配置的路径优先；缺失或版本不兼容的自动候选会跳过，不影响其他智能体启动。自动发现仅验证版本，登录是否有效仍以实际 ACP 会话建立为准。

通过官方 CLI 登录、更新并启动服务后，可在微信发送：“切到 WorkBuddy，读取 package.json 并告诉我测试命令，不修改文件。”也可先通过 `get_conversation_agents` 查询可用列表。若服务找不到终端中已安装的 CLI，检查服务 PATH，或使用下面的绝对路径配置。Windows 批处理 shim 不参与自动发现，只尝试可直接执行的程序。

先按项目的 `upgrade-local.sh` 流程手动更新本地实例。本页命令不会升级或重启服务。以下命令在更新后的源码目录运行，`/absolute/path/to/codebuddy` 必须换成自己的绝对路径；用 `command -v codebuddy` 查询。

```sh
# 打开官方 CLI，按其提示登录自己的账号；完成后退出 CLI。
node src/setup/agent.mjs login workbuddy --binary /absolute/path/to/codebuddy

# 手动停止服务后注册。
node src/setup/agent.mjs configure workbuddy --binary /absolute/path/to/codebuddy
node src/setup/agent.mjs status
```

配置写入账号私有 `agent.json`，在线服务存在时拒绝修改。注册检查版本，不把握手/认证方法列表当成已登录。手动启动服务后，可在原对话明确说“切到 WorkBuddy 接着做”，由已有管理协议 `get_conversation_agents` / `request_agent_switch` 建立顺序后续任务。只有前置任务的结构化结果确认成功才会释放后续任务，排队不等于已切换。初始化或登录失败时恢复原绑定，不提交模型任务、不自动重试。

在微信回复 WorkBuddy 即可绑定当前会话。

## 会话、权限与恢复

- 同一逻辑对话关联独立的 Codex / Claude / WorkBuddy 原生会话；共享平台消息、文件与交接摘要，不迁移底座内部推理。切回按原 ID 恢复，不按最近目录猜测，恢复失败不偷偷新建。
- 使用 ACP `initialize`、`session/new`、`session/load`、`session/prompt`、`session/update`、`session/request_permission` 与 `session/cancel`。不宣称全部智能体支持同一协议。
- 工具审批绑定当前会话/轮次，仅选择原协议提供的单次允许/拒绝，不自动授予永久权限。微信短审批回复只在存在所属待审批交互时生效；Mac/微信操作权规则保持不变。
- scoped 管理 MCP 沿用平台服务端鉴权和任务账本，凭据只通过会话 MCP 环境传入。平台任务结论仍来自身份匹配的 `report_task_result` 等结构化回执；ACP 轮次结束不代表业务完成或微信实际收到。
- 只有 `end_turn` 确认本轮正常结束；`cancelled` 确认中断；拒绝或限制结束标为未正常完成。连接丢失、未知结束原因保留未确认状态，不重跑。取消通知仅表示已请求，不能据此声称所有子进程已停止。
- 禁用 CLI 后台任务，过滤子智能体更新和恢复重放；不展示思考正文。首次仅提供串行主任务；执行中补充、Codex 原生目录/归档/删除/记忆/桌面接续等操作不向 WorkBuddy 发出 Codex RPC。
- 支持文本及经过既有附件授权的 PNG/JPEG（每张 8 MiB、合计 20 MiB），不冒充音频支持。模型列表仅来自 CLI 实际公告，缺失时不编造。

## 已验证及边界

模拟协议回归覆盖正文/工具事件、审批、取消、未知结果、断线、恢复不回退、模型边界、环境隔离、注册、切换回滚和 Mac 共享历史。隔离空 HOME 下，真实 2.187.0 CLI 握手返回 ACP v1、loadSession=true、multitaskSupport=false；session/new 返回标准认证错误 -32000，适配为明确登录提示。未使用真实账号推理、微信发送或桌面订阅验证；这些不能由模拟测试替代。当前运行实例须用户手动更新后验收。

官方资料：[ACP](https://www.codebuddy.ai/docs/zh/cli/acp)、[腾讯云 ACP 接入](https://cloud.tencent.com/document/product/1831/137021)、[协议扩展边界](https://cloud.tencent.com/document/product/1831/137025)、[安装登录](https://cloud.tencent.com/document/product/1831/137000)。

## 后台会话的可见性

审批/提问及最终结果使用显式通知类型发送，即使微信当前浏览其他会话也不会仅存入未读；消息标明所属会话，普通后台进度仍暂存，不改变导航或操作权。未知投递不自动重发。终端按结构化 agent_kind 展示底座名称，并显示 WorkBuddy 工具活动；等待审批不是模型持续执行，也不代表已有设计结果。
