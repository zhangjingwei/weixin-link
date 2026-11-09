# 应用层

此目录标记目标架构中的应用用例边界。现有实现仍位于 `src/core/intake/`、`src/core/durable-intake.mjs`、`src/core/schedules/` 与 `src/core/updates/`：消息分流、任务排队、会话执行、通知投递分别沿用原状态来源。后续迁移应保持收件确认、任务插入、取消和恢复语义，不为目录结构复制状态。
