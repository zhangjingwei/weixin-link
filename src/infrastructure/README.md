# 基础设施与外部适配

`ports.mjs` 组装 `src/application/ports/infrastructure-ports.mjs` 定义的五组函数接口。组合根按账号创建端口集合；`src/application/ports/message-ports.mjs` 再为消息用例选出不含 SDK 客户端的窄接口。端口不保存新的业务状态。

| 目录 | 当前实现 | 状态归属 |
| --- | --- | --- |
| `wechat/` | 微信 SDK 协议补丁与游标、消息发送账本、统一出站发送 | 原账号 SQLite 与 SDK 状态 |
| `agents/` | Codex / Claude 底座选择和新会话就绪检查 | 原底座和会话状态 |
| `media/` | 附件下载、预处理、出站文件与投递组件 | 原账号附件与投递记录 |
| `integrations/` | 按账号启用的集成调用、检查和指引 | 原私有配置与启用状态 |
| `storage/` | 跨进程注册表锁、原子更新、计划与版本通知状态文件；端口也构造现有 SQLite 收件队列 | 原注册表、状态文件与收件数据库 |
| `updates/` | 已安装版本读取和 GitHub 最新正式版查询 | 不保存新的版本状态 |

上述入口实现已移入本目录。`src/base/codex/`、`src/base/claude/`、`src/media/media-tools.mjs`、各集成插件和 SDK 辅助代码仍保持原位置；旧公开路径只做转发，供现有脚本和测试兼容调用。新组合代码从 `src/infrastructure/` 引用实现，不从兼容路径引用。

端口不把微信 SDK、凭据或远程配置传给应用用例；调用方传入本次账号和任务上下文。集成授权仍在每次调用时由原集成运行时复核；媒体下载范围、未知投递结果和锁文件行为均沿用原实现。
