# 任务控制

1. 判断用户要做什么：
   - 查询状态、进展或结果 → 直接调用 `get_project_status`、`get_project_progress` 或 `get_task_result`。
   - 补充运行中任务 → 执行“补充任务”工作流。
   - 停止运行中任务 → 执行“停止任务”工作流。
   - 调整排队任务 → 执行“调整队列”工作流。
   - 重发已有结果 → 执行“重发结果”工作流。
   - 核对不确定的持久任务 → 执行“核对任务”工作流。
2. 目标项目不明确时用 `resolve_target` 定位；有歧义时请用户选定。

## 补充任务

1. 用 `get_project_status` 查询运行中任务，取 `task.id` 和 `task.turnId`；排除 jobId 等于本次 sourceTaskId 的查询任务。
2. 将 `task.id` 作为 `taskId`，连同 `turnId` 和补充内容调用 `supplement_task`。
3. 核对工具回执；原任务已结束或回执不确定时查询原管理操作，不把补充排到下一轮。

## 停止任务

1. 用 `get_project_status` 查询运行中任务，取 `task.id` 和 `task.turnId`；确认要停止的项目及任务，排除本次查询任务。
2. 将 `task.id` 作为 `taskId`，连同 `turnId` 调用 `request_task_stop`；该操作会清空项目队列。
3. `requested` 只表示已请求停止；查询原管理操作及任务状态，直到能报告已确认的结果或明确说明仍不确定。

## 调整队列

1. 判断是 Codex 会话共享待办，还是微信助手持久任务；分别用 `list_thread_queue` 或 `list_project_tasks` 查询精确任务 ID。
2. 共享待办按请求调用 `request_queue_add`、`request_queue_edit`、`request_queue_remove`、`request_queue_reorder` 或 `request_queue_start`；持久任务用 `request_queue_change`，批量取消用 `request_queue_cancel_all` 并传刚查到的任务 ID 集合。
3. 核对工具回执和队列状态；新增共享待办可能立即执行，取消排队任务不停止已运行任务。

## 重发结果

1. 用 `get_task_result` 查询原任务结果；仅在用户明确要求重发且返回 `resultToken` 时继续，令牌不可用则说明无法重发。
2. 调用 `request_result_redelivery`，再查询原管理操作核对投递状态。`accepted` 不代表用户已收到。

## 核对任务

1. 用 `list_project_tasks` 找到状态不确定的持久任务及完整 `taskId`。
2. 调用 `request_task_reconciliation`，再查询原管理操作和任务状态；`requested` 只表示已安排核对，不代表重新执行或任务完成。

## 等待与业务结果

1. 本轮需要用户附件/回答时，读取 `get_conversation_context` 的 sourceTaskId、turnId，通过 `request_task_input` 提交 attachment/answer。只有确认回执后说明等待，不输出正文控制标记。
2. 明确实施任务结束时用 `report_task_result` 报告 completed/failed/blocked。这是智能体报告，不是平台独立验收；普通问答无需机械追加报告。
3. `execution=completed` 表示轮次执行结束；`taskOutcome=unknown` 不得解释成业务完成。转交后的 queued/handed_off 不代表目标已完成；delivery=accepted 不代表手机可见。
