# 消息进入与执行架构

![目标架构](message-flow-target.svg)

本项目保持每个微信账号一个本地服务实例的模块化单体。MVC 用于描述接口边界：微信 SDK 回调由 Controller 接收，回复由 View 适配后发送；中间通过应用用例和领域规则协作。DDD 在这里用于划清账号、会话、消息、任务和投递的职责，不引入第二套状态仓库或空壳聚合。

## 当前落地边界

| 职责 | 实现位置 | 规则 |
| --- | --- | --- |
| 组合根 | `src/wechat/bot.mjs` | 为本账号装配依赖，不再重复写命令判定或 SDK 入站流程 |
| 入站 Controller | `src/wechat/inbound-controller.mjs` | SDK 消息转换、账号过滤、原消息持久化和游标前检查；失败不能确认收件 |
| 命令意图 | `src/core/intake/message-intent.mjs` + `src/wechat/command-classifier.mjs` | 纯意图决策与微信命令解析分开；重放时按同一规则重新判定，不另存意图状态 |
| 消息应用处理 | `src/core/intake/message-application.mjs`、`src/core/durable-intake.mjs` | 控制命令立即处理；普通任务经持久队列逐会话执行、恢复和取消；`src/wechat/message-processor.mjs` 只绑定微信、媒体等适配 |
| 聊天管理 | `src/setup/chat-management.mjs` | 安装、切换底座和升级命令在管理边界执行，不进入普通模型任务队列 |
| 会话与底座 | `src/base/codex/codex-session.mjs`、`src/base/agent-adapter.mjs`、`src/base/agent-readiness.mjs` | 共享会话管理；账号启动时选择底座，新会话的底座就绪检查不进入消息应用处理 |
| 微信 View | `src/wechat/message-view.mjs`、`src/media/outbound-media.mjs` | 普通任务、控制回复、计划提醒和更新通知共用会话投递入口；映射收件人、格式化通知并串行发送；结果不明时保留状态 |

`message-application.mjs` 负责意图分流、权限、回执和任务提交；安装、切换与升级的具体执行委托给管理模块。后续扩展应继续按职责拆分，不在此文件新增供应商协议分支。图中“显式配置的上下文准备”是预留用例，当前集成不会自动预取外部信息。

## 与消息链路相连的其他能力

- `src/core/schedules/`：定时任务调用既有任务提交入口；提醒通过微信 View 调用通知投递入口。
- `src/core/updates/`：版本检查只产生升级提示，通过微信 View 调用同一投递入口，不自动升级。
- `src/setup/`：安装、账号启用和配置属于组合与管理边界，不是消息执行旁路。
- `src/integrations/`：按账号启用，运行时重新核验；本机智能体按需调用。SSH 远程 Codex 是此类集成和 `src/core/remote-tasks/` 的协作，不是消息处理器里的另一个智能体底座。
- 权限、账号隔离、去重、取消代际、未知投递结果和运行控制跨越上述边界，继续使用现有状态来源。

## 消息顺序

1. SDK 批次在推进轮询游标前检查消息、保存会话状态并持久化需排队的原消息；失败时向上抛错。
2. Controller 复用已解析的消息并识别控制命令。控制命令保留现有快速通道；普通消息持久化后交给应用处理。
3. 应用处理按统一规则分流，普通任务由 `DurableJobs` 与 `DurableIntake` 去重、排队和恢复，再交给当前账号的 `SessionManager`。
4. 智能体事件经现有会话与投递状态处理，由微信 View 和串行出站适配发送。

入站确认与任务插入的事务关系、原消息 ID 去重、会话归属和未知发送结果不自动重放均为重构时必须保持的不变量。
