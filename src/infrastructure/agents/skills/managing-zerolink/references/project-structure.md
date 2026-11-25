# 项目与会话结构

1. 判断用户要做什么：
   - 创建平台项目或显式导入 Codex 项目 → 执行“创建或导入项目”工作流。
   - 将会话归入同一仓库项目 → 执行“仓库归组”工作流。
   - 重命名、排序或整理会话分组 → 执行“整理结构”工作流。
   - 归档或还原微信绑定的会话 → 执行“归档会话”工作流。
   - 删除原生项目或会话分组 → 执行“删除结构”工作流。
   - 回退会话历史 → 执行“回退历史”工作流。
2. 用 `list_projects`、`list_project_sessions` 或 `list_thread_sections` 核对相应目标；目标有歧义时请用户选定。若 `get_conversation_context.projectWorkspace` 为 mismatch 或 unverified，停止派发；使用目录凭据和 `request_project_workspace` 核对平台边界，不按目录名或原生标题推断。

## 创建或导入项目

1. 用 `list_workspace_choices` 取得所选目录的 `workspaceToken`，核对项目名称与目录。
2. 新建平台项目调用 `create_project`，不连接智能体；导入已有项目调用 `request_project_import`，需要关联会话时传已核对的 threadId。
3. 新建核对平台 platformProjectId 与逻辑会话 projectId；显式原生导入才核对原生项目 ID。再查询项目列表；创建或导入本身不切换后续消息去向。

## 仓库归组

1. 用 `get_conversation_repository` 核对会话所属仓库并取得 `workspaceToken`；核对要归组的各个 threadId。
2. 调用 `associate_repository_conversations`，指定已有原生项目 ID 或新项目名称。
3. 查询原生项目及会话归属；仓库变化或工具回执不确定时查询原管理操作，不凭旧凭据重做。

## 整理结构

1. 按用户要求确定项目 ID、threadId 或 sectionId；项目排序使用原生项目 ID，创建或修改会话分组时先用 `list_thread_sections` 核对现有分组。
2. 对项目名称用 `rename_project`，项目顺序用 `request_project_move`；对分组用 `create_thread_section`、`request_section_rename` 或 `request_thread_move`。
3. 查询项目、会话或分组列表，核对工具回执对应的变化。

## 归档会话

1. 核对微信绑定会话的项目 ID 与当前任务状态。
2. 用 `request_project_archive` 归档或还原；`pending` 不代表完成。
3. 查询该会话状态或原管理操作，核对最终归档状态。

## 删除结构

1. 核对用户要删除的是原生项目还是会话分组，以及确切项目 ID 或 sectionId。
2. 分别调用 `request_project_delete` 或 `request_section_delete`；不把微信项目 ID 当作原生项目 ID。
3. 查询项目或分组列表，核对删除结果；工具回执不确定时查询原管理操作。

## 回退历史

1. 核对 threadId 和 beforeTurnId，说明该轮及后续历史会被删除、工作区文件不会回退。
2. 调用 `request_thread_revert`；再查询会话历史核对结果，工具回执不确定时查询原管理操作。
