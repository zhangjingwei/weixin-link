# 领域层

此目录标记目标架构中的账号、会话、消息、任务和投递规则边界。当前规则分布在 `src/core/conversations/`、`src/core/intake/`、`src/core/tasks/` 和 `src/core/delivery/`；尚未建立独立聚合或仓储框架。迁移前需以实际不变量为依据，不能把现有状态拆成两套。
