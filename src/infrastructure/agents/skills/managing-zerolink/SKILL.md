---
name: managing-zerolink
description: 用户通过微信助手管理项目、会话、任务、计划、桌面接续或服务时使用。
---

使用 `zerolink-management` MCP 处理管理请求；工具不可用时说明。

## 选择处理方式

1. 目标明确且单步可完成？直接调用对应工具，例如查询项目、任务状态与结果、会话历史、计划或服务状态。按工具返回的查询范围答复。
2. 需要定位目标、跨对象操作或核对后续状态？按任务类型读取对应工作流：
   - 打开、切换或跨会话执行 → [会话导航与交接](references/navigation.md)
   - 补充、停止、排队或核对任务 → [任务控制](references/task-control.md)
   - 创建、导入、归组、归档或回退 → [项目与会话结构](references/project-structure.md)
   - 创建或取消提醒、定时任务 → [计划管理](references/schedules.md)
   - 微信与桌面端之间接续 → [桌面接续](references/desktop-handoff.md)
   - 升级、重启或跳过版本 → [服务维护](references/maintenance.md)

## 共同约束

- `get_conversation_context.projectId` 和 `list_projects.callerProjectId` 指执行项目；`list_projects.projects[].active` 指微信选中项目。`list_projects.projects` 提供微信项目 ID，`list_projects.nativeProjects` 提供 Codex 项目；后者为空表示无项目，null 表示查询不可用。
- 新写操作用新 UUID 作 `requestId`，同一写操作重试沿用原 `requestId` 和参数。`queued`、`pending`、`scheduled`、`requested` 都不代表最终完成；工具回执不确定时查询原管理操作，不直接重做。
