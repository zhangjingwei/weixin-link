# 消息进入与执行架构

![目标架构](message-flow-target.svg)

本项目保持每个微信账号一个本地服务实例的模块化单体。`src/interfaces/` 按四个 Controller、微信 Presenter 和结构化 CLI 组织；`src/infrastructure/` 提供外部边界；收件、会话、任务执行与恢复、SSH 远端操作、计划和通知用例位于 `src/application/`。会话、消息、任务、投递、计划和版本的不变量位于 `src/domain/`。DDD 用于划清职责，不引入第二套状态仓库或空壳聚合。

静态模块依赖按 `domain → base → infrastructure → application → integrations → setup → interfaces → wechat` 的方向收敛，允许跳过中间层直接依赖更低层；`wechat/` 为账号服务组合根。`src/setup/service-entry.mjs` 是独立的 Windows 服务进程入口，启动 `wechat/bot.mjs`，不作为供其他模块复用的库。`tests/domain/layer-dependencies.test.mjs` 检查普通运行模块的跨层引用和循环。

## 当前落地边界

| 职责 | 实现位置 | 规则 |
| --- | --- | --- |
| 组合根 | `src/wechat/bot.mjs` | 为本账号装配依赖，不再重复写命令判定或 SDK 入站流程 |
| 微信入口 Controller | `src/interfaces/controllers/wechat-controller.mjs` | SDK 消息解析、账号过滤与游标前钩子；查重、设置指令冻结、控制分流、收件保存和队列捕获交给应用用例，失败不能确认收件 |
| 计划触发 Controller | `src/interfaces/controllers/schedule-controller.mjs` | 接入计划 API 与到期检查；请求授权和任务归属由应用层处理，提醒走 Presenter，任务走共享持久队列 |
| 更新检查 Controller | `src/interfaces/controllers/update-controller.mjs` | 接入定时检查；版本比较、提示去重及未知投递状态由应用层 `UpdateNotifier` 持有 |
| 管理 Controller | `src/interfaces/controllers/management-controller.mjs` | 接入微信安装、切换、升级命令与配置 CLI 参数；执行委托原管理和配置模块 |
| 命令意图 | `src/application/intake/message-intent.mjs`、`src/wechat/command-classifier.mjs`、`src/interfaces/wechat/*-command.mjs` | 接口层解析微信文本格式，应用层按优先级选择意图，领域层判断解析后的动作；重放时按同一规则重新判定，不另存意图状态 |
| 消息应用处理 | `src/application/intake/receive-message.mjs`、`message-application.mjs`、`src/application/tasks/durable-intake.mjs` | 游标前保存后入队；控制命令立即处理；普通任务经账号级持久队列逐会话执行、恢复和取消；队列记录保留所属底座，切换时不交给另一底座执行 |
| 会话与 SSH 远端操作 | `src/application/conversations/`、`tasks/local-recovery.mjs`、`remote-tasks/` | 本机 Codex 通过已启用集成从部署设备运行 SSH 命令；断线后的写结果保持不确定 |
| 附件消息 | `src/interfaces/wechat/voice-text.mjs`、`src/application/intake/single-media.mjs`、`src/infrastructure/media/` | 接口层提取微信转写和消息 ID；应用层提交单条附件任务；基础设施层下载、解析和交付文件 |
| 领域规则 | `src/domain/conversations/`、`messages/`、`tasks/`、`delivery/`、`schedules/`、`updates/` | 以归一化的会话归属、外部消息 ID、已确认拒绝证据判断状态；不读取微信原始字段或 API 错误码，不直接执行 I/O |
| 会话与底座 | `src/application/conversations/session-manager.mjs`、`src/wechat/session-manager.mjs`、`src/infrastructure/agents/session-protocol.mjs` | 应用层管理会话归属、排队、状态与投递；基础设施适配器封装底座建连、输入、恢复和能力；组合根按账号注入所选适配器 |
| 微信 View / Presenter | `src/interfaces/views/wechat-presenter.mjs`、`src/infrastructure/media/outbound-media.mjs` | 普通任务、控制回复、计划提醒和更新通知共用会话投递入口；映射收件人、格式化通知并串行发送；结果不明时保留状态 |
| 基础设施端口 | `src/application/ports/infrastructure-ports.mjs`、`src/wechat/infrastructure-ports.mjs`、`src/infrastructure/storage/`、`src/infrastructure/updates/` | 组合根注入协议、底座、媒体等能力；账号目录统一保存收件、任务及微信发送账本，底座目录保存各自会话状态；计划与更新用例通过存储及版本查询适配器执行外部操作，不复制状态 |

`message-application.mjs` 负责意图分流、权限、回执和任务提交；安装、切换与升级的具体执行委托给管理模块。调用方直接导入所属模块。后续扩展应继续按职责拆分，不在此文件新增供应商协议分支。图中“显式配置的上下文准备”是预留用例，当前集成不会自动预取外部信息。

## 与消息链路相连的其他能力

- `src/application/schedules/`：计划用例管理到期状态，注入的 `src/infrastructure/storage/schedule-state.mjs` 保存计划；到期任务提交到既有队列，提醒通过微信 Presenter 投递。时间规则位于 `src/domain/schedules/`。
- `src/application/notifications/`：版本提示和失败终答复恢复用例；通知状态与版本查询由 `src/infrastructure/` 适配，版本比较与重试资格位于 `src/domain/`。更新 Controller 只触发检查，不自动升级。
- `src/setup/`：安装、账号启用和配置属于组合与管理边界，不是消息执行旁路。
- `src/integrations/`：按账号启用，运行时重新核验；本机智能体按需调用。SSH 远端操作由本机 Codex 调用，远端不运行 Codex。
- `src/infrastructure/remote/`：提供 SSH 命令传输、主机配置和路径边界；不再维护远端 Codex 任务账本。
- 权限、账号隔离、去重、取消代际、未知投递结果和运行控制跨越上述边界，继续使用现有状态来源。

## 消息顺序

1. SDK 批次在推进轮询游标前检查消息、保存会话状态并持久化需排队的原消息；失败时向上抛错。
2. Controller 复用已解析的消息，应用用例按注入的命令解析器分流。控制命令保留现有快速通道；普通消息持久化后交给任务处理。
3. 应用处理按统一规则分流，普通任务由 `DurableJobs` 与 `DurableIntake` 去重、排队和恢复，再交给当前账号的 `SessionManager`。
4. 智能体事件经现有会话与投递状态处理，由微信 View 和串行出站适配发送。

入站确认与任务插入的事务关系、原消息 ID 去重、会话归属和未知发送结果不自动重放均为重构时必须保持的不变量。
授权入站消息必须带 `message_id` 或 `client_id`；两者都缺失时拒绝整批消息，不生成临时 ID，也不推进轮询游标。

自然语言管理入口沿用管理控制边界：MCP 接口 → 私有控制端点 → 应用管理门面 → 既有会话/任务用例。详见 [MCP 管理说明](../features/management-mcp.md)。

统一入口的跨项目任务仍经管理门面进入原 DurableJobs/DurableIntake；路由随任务持久化，目标项目独立执行，Presenter 按任务直接返回原微信用户，不改变会话选择或另建协调队列。

## 独立入口意图分流

普通纯文本在进入项目执行队列之前，由 entry-routing 调用基础设施注入的独立分类端口。分类进程使用临时 CODEX_HOME，仅复制当前账号认证，禁用插件、MCP、应用、Shell、浏览器与多智能体，使用临时目录、只读沙箱和拒绝工具请求；仅返回有界结构化动作，不拥有项目执行权限。临时认证副本在完成、超时或失败后清理，不写入仓库。

应用层重新核对用户归属、目标、线程和原任务身份；写操作复用管理操作去重及 DurableJobs 队列，同项目顺序执行、不同项目可并行。状态、历史、结果查询直接使用管理只读接口，不等待项目任务，不向项目开放并行写权限。入口只串行化短分类/分发过程，不等待任务执行完成。

分流决策保存在既有账号会话状态，沿用原 ingress 记录与游标确认；重启后复用决策和固定 requestId，不重新执行未知写操作。通知发送中断时保留 sending，避免自动重复投递。附件、引用、交互提示、等待附件续接仍走原链路；分类不可用或队列达到上限时回退原执行队列，不丢弃原请求。分类本身会消耗一次模型调用，失败回退时仍可能等待当前项目。

意图识别独立选择低成本模型，不继承项目执行模型：先查账号实际可用模型，按 gpt-6-luna → gpt-5.6-luna 的已知低成本候选顺序选择，使用 low 推理和 fast 快速档，用量消耗可能增加；项目执行速度档不受影响。候选不可用、底座未确认所选模型或固定第三方供应商场景直接回退原队列，不自动升级到更贵模型。此候选顺序依据 2026-11-23 官方 Work/Codex 标准 token 价格表，非运行时自动价格比较，也不承诺不同订阅协议的实际扣费相同；后续定价变化需更新策略。来源：https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing 。

任务显示标题由入口分类器概括并随原任务路由保存；旧任务通过原始请求生成标题。标题仅用于展示，内部任务 ID、归属校验、去重和取消仍沿用原身份，不以标题作为执行或授权标识。
