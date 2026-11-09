# 应用层

此目录标记目标架构中的应用用例边界。`ports/infrastructure-ports.mjs` 校验组合根的五组外部能力；`ports/message-ports.mjs` 从中选择消息用例所需的窄接口，不向用例暴露 SDK 客户端或凭据。现有用例仍位于 `src/core/intake/`、`src/core/durable-intake.mjs`、`src/core/schedules/` 与 `src/core/updates/`。后续迁移应保持收件确认、任务插入、取消和恢复语义，不为目录结构复制状态。
