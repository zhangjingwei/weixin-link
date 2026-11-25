# 会话导航与交接

1. 判断用户要做什么：
   - 打开或接续会话 → 执行“打开会话”工作流。
   - 改变后续微信消息去向 → 执行“切换会话”工作流。
   - 给另一项目提交新文字任务 → 执行“提交任务”工作流。
   - 把本轮请求及材料交给另一会话执行 → 执行“转交请求”工作流。
2. 用 `list_projects`、`list_project_sessions` 或 `search_sessions` 定位目标；`list_project_sessions({})` 查询平台逻辑会话；显式 nativeProjectId 才查询 Codex 原生会话，翻页沿用原范围和 `nextCursor`。目标有歧义时请用户选定。

## 打开会话

1. 平台逻辑会话已存在时直接使用其 projectId，不重新打开原生会话。新建用 platformProjectId 或 `list_workspace_choices` 的凭据调用 `open_conversation`；返回 threadId=null 表示尚未连接，不是失败。只有显式导入 Codex 原生会话时才传 threadId/nativeProjectId。
2. 核对工具回执，返回会话信息；不改变后续微信消息去向。

## 切换会话

1. 确定目标的微信项目 ID；尚未绑定的会话先按“打开会话”工作流接入。
2. 调用 `request_project_switch`；按工具回执及后续通知核对切换结果，不把 `pending` 当作已切换。

## 提交任务

1. 确定另一项目的微信项目 ID 和新文字任务内容，调用 `submit_project_task`。
2. `queued` 只表示任务已排队；等待原任务链路通知结果，不改变后续微信消息去向。

## 转交请求

1. 用 `get_conversation_context` 查询 `sourceTaskId`、`alreadyRouted` 和本轮材料；若 `alreadyRouted` 为真，直接在目标会话处理，不再转交。
2. 核对目标会话及本轮原文、引用、附件是否可交接；必要时先按“打开会话”工作流接入目标。
3. 已连接的目标须传查询得到的 threadId；未连接的新逻辑会话省略 threadId。用 `sourceTaskId` 调用 `route_conversation_request`；依赖已定方案时附 `agreedPlan`。
4. `queued` 后结束发起会话的本轮，等待目标任务的后续通知；回执不确定时查询原管理操作，不另起相同任务。
