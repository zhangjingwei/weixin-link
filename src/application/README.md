# 应用层

应用用例在此目录运行，组合根注入现有会话、持久化和出站能力，不另建状态仓库。

- `intake/`：游标前收件保存、查重、设置指令冻结、普通消息入队、控制消息分流与单条附件任务提交。微信 SDK 解析及消息格式转换留在接口层；命令解析器和附件消息上下文由组合根注入。
- `tasks/`：持久任务逐会话执行、取消检查、本地和远程结果恢复；任务记录由 `src/infrastructure/storage/durable-jobs.mjs` 保存。
- `conversations/`：会话门面、官方目录同步、选择、归档、删除、历史与有序投递；沿用原 `SessionManager` 状态和锁。
- `remote-tasks/`：远程任务选择、提交、对账、停止、文件交付与进度转发；状态由基础设施注册表保存。
- `diagnostics/`：诊断命令处理与报告生成，读取脱敏事件日志。
- `schedules/`：计划请求授权、到期任务路由、计划状态与重试。状态文件由注入的基础设施存储端口管理，提醒经微信 Presenter 投递。
- `notifications/`：版本提示和失败终答复恢复。状态文件与版本查询通过注入的基础设施端口访问；保留未知投递结果，不自动重发。
- `ports/`：校验组合根的外部能力并暴露窄接口，不向用例暴露 SDK 客户端或凭据。

调用方直接导入所属应用用例；`src/core/` 只保留旧命令路径的兼容入口。收件确认、任务插入、取消与恢复继续使用同一份状态。

## Personal host concurrency and project directories

Host backends intentionally share the OS user's filesystem. Different accounts
and conversations can execute concurrently, including in the same directory.
The application DurableIntake serializes each conversation's queue; delivery remains serialized
per real recipient, and cancellation stays scoped to the originating conversation.
There is no global host execution gate or default local project write lock.

Concurrent edits to the same files can conflict. Separate worktrees can separate
code edits; use the existing isolated backend when an execution boundary is
needed. Isolation still depends on mounts and OS permissions. Conversation
separation alone does not isolate files. Existing remote-task coordination and
service/configuration maintenance locks are unchanged.

A newly created project can store a canonical workspace before its first thread
connection. Existing threads retain their old directory. The same workspace is
used for RPC creation, thread start/resume, Claude workspace guidance and output
packaging. Project labels and directory authorization remain distinct.

The experimental global gate from f8146f1 is removed. Its reservation file is no
longer read and does not block execution; this does not reconcile old tasks or
prove their processes stopped. Drain experimental services and verify unfinished
tasks before replacing them. This change does not delete private runtime files.

Background chat upgrades preserve the originating `trace_id` in the request and
transaction journal. Failed requests record a bounded error code and stage; raw
subprocess output is not persisted. Upgrade subprocesses prepend the active Node
directory to PATH, and npm is resolved beside that Node rather than via a login
shell. A completed chat reply only confirms scheduling; the upgrade record and
installed release marker establish the deployment result.
