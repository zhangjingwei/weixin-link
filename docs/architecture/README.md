# 消息进入与执行架构

![目标架构](message-flow-target.svg)

本项目保持每个微信账号一个本地服务实例的模块化单体。`src/interfaces/` 已按图中的四个 Controller 与微信 Presenter 组织；`src/infrastructure/` 已迁入外部边界入口，`src/application/ports/` 定义供后续用例注入的接口。应用与领域规则主要仍在 `src/core/`，后续按不变量分阶段迁移。DDD 在这里用于划清账号、会话、消息、任务和投递的职责，不引入第二套状态仓库或空壳聚合。

## 当前落地边界

| 职责 | 实现位置 | 规则 |
| --- | --- | --- |
| 组合根 | `src/wechat/bot.mjs` | 为本账号装配依赖，不再重复写命令判定或 SDK 入站流程 |
| 微信入口 Controller | `src/interfaces/controllers/wechat-controller.mjs` | SDK 消息转换、账号过滤、原消息持久化和游标前检查；失败不能确认收件 |
| 计划触发 Controller | `src/interfaces/controllers/schedule-controller.mjs` | 将计划 API 请求映射到当前会话；到期提醒走 Presenter，到期任务走共享持久队列；计划状态仍由 `ScheduleService` 持有 |
| 更新检查 Controller | `src/interfaces/controllers/update-controller.mjs` | 接入定时检查；版本比较、提示去重及未知投递状态仍由 `UpdateNotifier` 持有 |
| 管理 Controller | `src/interfaces/controllers/management-controller.mjs` | 接入微信安装、切换、升级命令与配置 CLI 参数；执行委托原管理和配置模块 |
| 命令意图 | `src/core/intake/message-intent.mjs` + `src/wechat/command-classifier.mjs` | 纯意图决策与微信命令解析分开；重放时按同一规则重新判定，不另存意图状态 |
| 消息应用处理 | `src/core/intake/message-application.mjs`、`src/core/durable-intake.mjs` | 控制命令立即处理；普通任务经持久队列逐会话执行、恢复和取消；`src/wechat/message-processor.mjs` 只绑定微信、媒体等适配 |
| 会话与底座 | `src/base/codex/codex-session.mjs`、`src/infrastructure/agents/` | 共享会话管理；账号启动时选择底座，新会话的底座就绪检查不进入消息应用处理 |
| 微信 View / Presenter | `src/interfaces/views/wechat-presenter.mjs`、`src/infrastructure/media/outbound-media.mjs` | 普通任务、控制回复、计划提醒和更新通知共用会话投递入口；映射收件人、格式化通知并串行发送；结果不明时保留状态 |
| 基础设施端口 | `src/application/ports/infrastructure-ports.mjs`、`src/infrastructure/ports.mjs` | 五组函数接口由组合根注入；协议、底座、媒体、集成及锁存储不复制状态 |

`message-application.mjs` 负责意图分流、权限、回执和任务提交；安装、切换与升级的具体执行委托给管理模块。后续扩展应继续按职责拆分，不在此文件新增供应商协议分支。图中“显式配置的上下文准备”是预留用例，当前集成不会自动预取外部信息。

## 与消息链路相连的其他能力

- `src/core/schedules/`：保留计划持久化和到期状态机；计划 Controller 把任务提交到既有队列，提醒通过微信 Presenter 投递。
- `src/core/updates/`：保留版本比较和提示状态；更新 Controller 只发升级提示，通过微信 Presenter 投递，不自动升级。
- `src/setup/`：安装、账号启用和配置属于组合与管理边界，不是消息执行旁路。
- `src/integrations/`：按账号启用，运行时重新核验；本机智能体按需调用。SSH 远程 Codex 是此类集成和 `src/core/remote-tasks/` 的协作，不是消息处理器里的另一个智能体底座。
- 权限、账号隔离、去重、取消代际、未知投递结果和运行控制跨越上述边界，继续使用现有状态来源。

## 消息顺序

1. SDK 批次在推进轮询游标前检查消息、保存会话状态并持久化需排队的原消息；失败时向上抛错。
2. Controller 复用已解析的消息并识别控制命令。控制命令保留现有快速通道；普通消息持久化后交给应用处理。
3. 应用处理按统一规则分流，普通任务由 `DurableJobs` 与 `DurableIntake` 去重、排队和恢复，再交给当前账号的 `SessionManager`。
4. 智能体事件经现有会话与投递状态处理，由微信 View 和串行出站适配发送。

入站确认与任务插入的事务关系、原消息 ID 去重、会话归属和未知发送结果不自动重放均为重构时必须保持的不变量。
