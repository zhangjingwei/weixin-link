# 消息进入与执行架构

本项目是按微信账号装配的模块化单体。`src/wechat/bot.mjs` 是组合根；微信、Codex 和可选集成是外部系统。新增能力先确定所属层和状态来源，再通过端口接入，避免在入口重复实现业务规则。

![当前消息与任务架构](message-flow-target.svg)

图展示当前主要模块与消息路径；专项规则以下文链接为准。

## 模块边界

| 位置 | 职责 | 典型入口 |
| --- | --- | --- |
| `src/interfaces/` | 接收微信、计划、更新和管理触发；解析外部格式；呈现状态与结果 | `controllers/`、`views/wechat-presenter.mjs`、`wechat/` |
| `src/application/` | 收件与意图分流、持久任务、会话与投递、远程任务、计划、通知和诊断用例；定义外部端口 | `intake/`、`tasks/`、`conversations/`、`ports/` |
| `src/domain/` | 授权归属、消息身份、任务状态、取消代际、投递与计划等规则 | `conversations/`、`messages/`、`tasks/`、`delivery/` |
| `src/infrastructure/` | 适配微信、Codex、媒体、存储、SSH 和私有运行端点 | `wechat/`、`agents/`、`media/`、`storage/`、`remote/` |
| `src/base/`、`src/integrations/` | Codex 底层协议和按账号启用的可选集成 | 各自模块 |
| `src/setup/`、`src/wechat/` | 安装、配置、服务入口、账号档案及组合根 | `src/setup/service-entry.mjs`、`src/wechat/bot.mjs` |

普通运行模块的静态依赖按 `domain → base → infrastructure → application → integrations → setup → interfaces → wechat` 收敛；箭头表示更上层可以依赖更左侧模块，也允许跳过中间层。跨层协作优先使用应用层端口和组合根注入。领域层不读取微信原始字段或直接执行 I/O。`tests/domain/layer-dependencies.test.mjs` 检查跨层引用与循环。

`src/setup/service-entry.mjs` 是独立的 Windows 服务进程入口，用于启动 `wechat/bot.mjs`，不是供其他模块复用的库。账号目录保存收件、任务与投递状态；底座目录保存各自会话状态。不为新功能建立第二套账本。

## 消息主链路

1. 微信入口 Controller 解析 SDK 消息并校验账号。轮询游标推进前，应用用例保存需排队的原消息和会话状态；保存失败则不确认收件。授权消息缺少 `message_id` 和 `client_id` 时拒绝整批，不生成临时身份。
2. `src/application/intake/` 识别明确的原生命令并处理控制分流；普通消息由 `DurableJobs` 和 `DurableIntake` 去重、排队与恢复。
3. 当前账号的 `SessionManager` 将普通文本交给已选 Codex 会话理解。会话按需通过管理 MCP 查询状态、切换项目或派发跨项目任务；服务端重新核验会话、目标与授权，并复用原任务队列。队列记录保留底座归属，切换底座不会改派旧任务。
4. 智能体事件进入会话和投递用例，由微信 Presenter 格式化，再经串行出站适配发送。发送结果不明时保留可核对状态，不自动重发。

收件、入队与游标确认的顺序，以及重放去重、会话归属和未知投递结果，是修改链路时必须保留的语义。`message-application.mjs` 负责分流、权限、回执和任务提交；安装、切换与升级的执行交给管理模块，不在此处添加供应商协议分支。

## 其他入口与扩展

- 计划 Controller 将到期任务交给共享持久队列，将提醒交给 Presenter；计划时间规则在 `src/domain/schedules/`。
- 更新 Controller 只触发检查；版本比较、提示去重和投递恢复由领域与通知用例处理，不自动升级。
- 管理 Controller 接入安装、配置与切换。自然语言管理入口经 MCP、私有控制端点和应用管理门面复用现有会话与任务用例，见[管理 MCP](../features/management-mcp.md)。
- 统一入口的跨项目任务由当前 Codex 会话按需调用管理 MCP，沿用管理门面、`DurableJobs` 和 `DurableIntake`；同项目顺序执行，结果返回原微信用户。任务标题只用于展示，不作为授权或去重身份。操作与附件交接规则见[统一入口](../features/unified-entry.md)。
- SSH 远端操作由本机 Codex 通过已启用集成发起；远端不运行 Codex，也不维护另一套任务账本。断线后写操作的结果保持不确定。
- 桌面接续复用管理用例与会话状态，默认关闭；见[桌面接续边界](../features/codex-desktop-handoff.md)。

权限、账号隔离、幂等、取消和运行控制贯穿这些入口。新增入口应复用对应应用用例与状态来源。
