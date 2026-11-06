# 远程任务协调

remote-task-client.mjs 将共享 Codex 协议客户端接到远程连接管理器。每条新连接通过统一握手初始化，并按原 thread_id/cwd 恢复会话；不重新创建轮次。

读取只有在 Codex 只读方法白名单中才允许断线后重试一次。写请求的结果不确定时只恢复连接，保留不确定结果交给账本对账，绝不自动重放。

remote-controller.mjs 负责项目边界、会话归属、提交、对账、指定轮次停止、后台命令清理和文件交付。remote-store.mjs 复用 core 的持久化锁；remote-watch.mjs 负责进度去重和投递；remote-stop.mjs 接入本地停止流程。

remote-cli.mjs 是结构化 JSON 命令入口。凭据、主机配置和 remote-sessions.json 继续位于用户私有工作目录，不随源码发布。
