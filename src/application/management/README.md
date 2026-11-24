# 管理用例

MCP 是接口，管理用例复用既有会话、投递、计划和版本服务。组合根注入 manager、conversations、deliver、schedules、updates；不导入 Controller，不新建任务队列或业务数据库。

- management-service：调用方归属、目标解析、只读状态、签名游标，以及需等待工具回执的异步管理流程。
- management-writes：新增操作共用的请求去重、意图持久化、失败及重启语义；沿用 manager.state.managementOperations。
- project-management：目录凭据校验、新建记录、命名；新建不切换，目录校验复用 workspace 用例。
- history-search：有界搜索与文本分片续接；原历史服务负责授权读取和内容净化。
- result-management：只读结果、原快照重发、指定持久任务核对；投递沿用 OutputStore/Presenter，核对沿用 DurableJobs/DurableIntake。
- schedule-management、update-management：窄端口适配现有应用服务，不绕过账号归属或复制状态机。
- project-task-management：跨项目文字任务经原持久队列提交，保留任务归属、去重与统一入口回传。
- tools：封闭输入契约及边界校验，供 MCP 与私有控制入口共同使用。

新写操作先保存意图，再调用现有用例。结果未知不自动重放；重启时 executing 记 unknown，未激活 pending 记 not_executed。文件重发和任务核对收到工具回执后才激活；补充、停止仍精确绑定原轮次。原精确命令保留紧急控制能力。

maintenance-management 与 project-archive-management 分别处理回执后的维护调度和归档/还原；组合根通过窄端口接入原维护工作进程，不在应用层导入 setup。

model-management 保存按项目隔离的后续轮次模型偏好；复用原模型查询、管理操作去重与会话存储，不中断当前轮次，不切换供应商。

progress-management 只组织可核实结果证据和当前状态；queue-management 用精确任务快照操作原持久队列，不修改运行任务。入口状态是既有会话状态的只读投影。

桌面接续由 desktop-management 负责：复用原管理操作、会话状态和队列；desktop 端口仅负责同机客户端检查、打开及关闭后读取原线程。持久交接标记在 manager.state.desktopHandoff；默认关闭，不另建任务状态库。
