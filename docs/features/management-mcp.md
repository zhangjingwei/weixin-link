# 自然语言管理：MCP + Skill

本期把既有项目、会话、结果、计划和更新管理 API 包装为一个本地 `zerolink-management` MCP 和 `managing-zerolink` Skill。模型负责理解自然语言和转写，服务端负责归属校验与执行。没有额外模型 API Key；仍使用账号已配置的底座和计费方式，订阅是否支持取决于该账号的 Codex 授权。本期仅接 Codex，不新增 Claude 底座，也不自行做语音识别。

## 使用

- “知识库做到哪了”：查候选、任务状态，必要时读历史；不切换项目。
- “切换到知识库”：唯一匹配后提交切换。当前回复结束后由既有连接用例核对目标，系统通知确认结果。
- “给知识库当前任务补充：需要支持导出”：绑定原任务和轮次提交，任务已结束时拒绝，不排到下一任务。
- “停止知识库当前任务”：停止指定原任务，并复用原取消流程清空其排队消息；请求已提交不等于确认停止。
- “有哪些模型”：只查询，不改模型。

同名项目会询问用户选择，无匹配不会扫描整个磁盘或创建项目。候选只来自当前账号下该用户已登记的会话，不是智能全文搜索；“知识库做到哪了”里的业务别称未命中时需澄清。查询不是执行授权，模型理解仍可能出错；日常管理统一走 MCP，自然语言停止保留为模型不可用时的应急兜底。

## 工具边界（共36项）

| 工具 | 输入要点 | 结果/边界 |
| --- | --- | --- |
| resolve_target | query | unique / ambiguous / not_found；只读，不切换 |
| list_projects | 无 | Codex 项目及微信已登记的会话 |
| get_project_status | projectId | 本地执行、队列、恢复状态、管理操作；不是项目完成度 |
| get_session_history | projectId、可选 cursor | 文本分块和绑定目标的续页，不重发附件 |
| request_model_switch | projectId, model, requestId | 保存指定项目的模型选择，后续新任务生效；不改供应商、不打断当前任务 |
| list_models | 无 | 底座结构化模型列表；不切模型 |
| submit_project_task | projectId、text、requestId | 新任务持久排队，不切换入口；项目结果直接回传 |
| request_project_switch | projectId、requestId | pending；完成后独立通知 |
| supplement_task | projectId、taskId、turnId、text、requestId | 原任务 accepted / rejected / unknown 等回执 |
| request_task_stop | projectId、taskId、turnId、requestId | pending → requested；停止结果看原会话最终事件 |

| get_management_operation | operationId | 当前用户的具体管理操作回执，不重放 |
| list_workspace_choices | 来源 projectId | 当前目录及允许子目录，五分钟绑定凭据 |
| create_project | name、workspaceToken、requestId | 通过 project/create 创建原生项目，返回 nativeProjectId |
| rename_project | projectId、name、requestId | 沿用命名用例，已有线程需底座确认 |
| search_session_history | projectId、query、可选 cursor | 最近最多50轮；返回范围、时间、位置与续页 |
| list_project_tasks | projectId、offset、limit | 完整持久 taskId；不暴露原请求正文 |
| get_task_result | projectId、可选 taskId、cursor | 只读文本分页和附件摘要；不发文件 |
| request_result_redelivery | projectId、resultToken、requestId | 绑定原快照，检查完整性/有效期后投递 |
| request_task_reconciliation | projectId、完整 taskId、requestId | 指定原任务核对，不重新执行 |
| get_service_status | 无 | 当前账号服务就绪与忙闲状态 |
| get_installation_status | 无 | 安装检查和已有推理验收记录，不发起新推理 |
| get_diagnostics | 无 | 当前账号脱敏诊断与最近错误 |
| get_usage_guide | 可选 language | 自然语言指南与应急命令 |
| get_maintenance_status | 无 | 原维护工作进程的真实状态 |
| request_service_restart | requestId | 回执后安排当前账号空闲重启 |
| request_upgrade | updateToken、requestId | 回执后安排确切版本的共享安装升级 |
| request_project_archive | projectId、archived、requestId | 归档/还原请求，复用原核对流程 |
| check_updates | 无 | 只读版本信息、摘要及绑定版本的凭据 |
| skip_update | updateToken、requestId | 跳过确切版本，保留后来版本提示 |
| create_schedule | projectId、kind、text、at 或 repeat、requestId；可选 timeZone | 原计划服务保存，回传计划ID、时区和下次时间 |
| list_schedules | offset、limit | 当前用户计划、目标项目、状态和服务时间/时区 |
| cancel_schedule | scheduleId、requestId | 取消未来触发，不停止已提交任务 |


taskId、turnId 必须来自刚查询的任务状态，不能拿旧任务身份作用到下一轮。每次写操作生成新 UUID；同一操作重试保持原 requestId 和参数。相同编号不同参数报冲突。去重记录至少保留七天，每次写入及服务启动时清理超过七天的已结束记录，10,000条配额按用户独立计算；未知操作保留至人工核对；查询 operations 可查看请求状态。历史单轮按时间顺序展示，每次返回最多 10,000 字符，nextCursor 继续该轮剩余文本或更早轮次，不丢弃超长内容。游标绑定用户、项目、线程并签名；服务重启后从第一页重查。

## 安装、禁用、卸载

标准安装/升级后的账号服务启动时，自动把 Skill 注册到该账号私有 CODEX_HOME/skills，MCP 仅注入该账号具体会话的 app-server 进程。不修改个人全局 Codex 配置，不修改项目工作目录；管理令牌仅通过进程环境传递，不写入源码、Skill 或命令行参数。已有连接需重新连接才能加载。

在安装电脑的源码目录操作：

```sh
node src/setup/setup.mjs management-plugin status [账号]
node src/setup/setup.mjs management-plugin remove [账号]
node src/setup/setup.mjs management-plugin install [账号]
```

默认账号为 default。remove 保存禁用选择，并移除完整性校验仍匹配的托管 Skill；修改过的用户文件保留。install/升级不会覆盖同名自建 Skill；冲突时明确报错，可先 remove 禁用此功能使服务按原方式启动。启停配置只在后续服务启动读取；移除后已连接进程暂保留当前工具，重启账号服务后生效。上述命令不会自行重启服务，也不会卸载 Codex、删除项目或聊天历史。

完整卸载在确认程序服务已停止后移除各账号未修改的托管 Skill；账号数据和工作区按既有策略保留。插件目录随完整源码包分发，`.codex-plugin/plugin.json` 和 `.mcp.json` 声明组成；它不是可独立搬走的 npm 包或公共插件市场条目。脱离 ZeroLink 可信会话上下文启动 MCP 会拒绝服务。

## 架构与可靠性

入口为接口层 MCP stdio → 账号私有控制 socket → management-mcp-controller → 应用层 ManagementService → 既有 TextConversations / SessionManager → 底座适配。模型不传 owner、收件人、任意 RPC 方法、任意 threadId 或认证令牌。

每个活跃 RPC attempt 绑定随机 capability，控制端每次核对当前 session 和 attempt，连接替换后旧凭据失效。Unix socket 保持 0600，Windows 使用现有私有 pipe/token 机制；没有新增网络监听端口。输入采用封闭 schema、长度限制；错误只返回稳定错误码。

沿用 assistant-sessions.json 与 DurableJobs，无第二套会话/任务数据库。管理操作元数据保存在同一会话状态中；同一用户只允许一项待处理管理操作。未执行请求五分钟过期；重启将未激活操作标记 not_executed、执行中操作标记 unknown，绝不自动重放写操作。确定未执行的重发请求（含过期、附件不可用及重启取消）会清除管理记录中的正文快照、投递包和凭据，仅保留去重及审计元数据；执行结果未知时保留核对资料。停止和切换先将 MCP 工具回执写到 stdio，再激活服务端操作；工具回执写出不证明用户已阅读。切换等待发起轮结束，后续显式选择会使旧请求失效。维护排空/封存期间不接收新操作，后台操作进入同一 runtime 忙闲计数。

运行状态只表示观察到的执行、排队和投递证据。停止 requested 不能证明子进程已全部退出；以原链路确认结果为准。目录来自本地配置时明确标注 local_configuration，切换成功通知仍用底座确认的 cwd。

## 验证

```sh
node --test tests/management/*.test.mjs
node src/tools/verify-management-native.mjs
```

第二条在临时 HOME/CODEX_HOME 中运行项目固定版本的真实 Codex，只创建空线程并检查 Skill 和 36 个 MCP 工具加载，不登录、不启动模型轮次、不访问生产账号状态。自动测试验证协议、身份、歧义、长历史、陈旧任务、去重和安装保护；不等于真实微信或跨平台人工验收。

## 第二批能力的约束

新建项目先取来源目录候选，凭据绑定用户、来源项目、真实根目录、目标目录和设备/inode，五分钟有效；创建前重新校验，不能把模型提供的任意路径当授权。目录选择不是操作系统沙箱。新建会通过 app-server 创建原生项目；微信保存会话操作编号。list_project_sessions 按原生项目 ID 查询会话，create_project_session 可新建会话或绑定指定 threadId。后续切换需单独请求。普通聊天继续使用当前会话。

微信文字和语音中的“结果”进入普通对话，通过 get_task_result 只读查询。新结果保存完整任务/线程/轮次身份；旧记录采用明确的兼容身份。查询文本按最多10,000个字符分块，历史附件链接不作为新交付链接。指定持久任务可从其原线程只读核对历史文本，最近20份旧结果的文本和附件清单保存在同一会话状态中，重发查询窗口为7天；过期元数据在后续结果归档时清理，不另存文件字节。超出该范围、没有保留清单时 redeliveryAvailable=false，不猜测文件位置。最近结果的 resultToken 十分钟有效；提交重发时把确切快照冻结到同一管理操作中，之后即使新结果到达也不改发新结果。投递前验证全部附件的归属、保留期、大小和哈希；不可用则不先发文字、不重新生成。accepted 只表示现有投递接口的确认，不表示用户已阅读。

任务核对先按完整持久 taskId 验证归属和 uncertain 状态。空闲后仅将那一条记录送回既有恢复流程；不把 pending 新任务当作恢复对象，不调用 turn/start 重执行旧任务。恢复结果仍由原 DurableIntake/SessionManager 保存。项目状态附最近20条管理操作摘要；具体操作用 get_management_operation 查询。

搜索最多覆盖最近50轮，每次处理一个轮次或其中最多10,000字符；长文本跨片匹配保留接缝。每片最多返回20个命中摘要，并标记省略命中数量；complete/limited/nextCursor 说明实际覆盖边界，内容变化时拒绝旧续页而非静默漏读。

定时操作直接复用原 ScheduleService，服务端绑定目标项目而非接受任意 threadId。创建请求的去重身份与计划在同一计划状态中原子保存，重启后保持；返回时间为实际下一次触发，另给时区和本地显示。提醒与任务都保留来源项目，任务到期仍进入原持久队列。取消不撤回已经提交的任务，回执明确 futureTriggersCancelled、taskMayStillBeRunning 和 runningTaskStopped。

检查更新只读取已安装版本与正式 Release，沿用原版本比较规则。跳过凭据十分钟有效并绑定用户与确切版本；若期间已记录更新的版本，保留新版状态，只给旧版添加跳过偏好，不误将新版标记为 dismissed。

## 统一入口提交项目任务

在当前微信入口说“让工具箱优化搜索页面”即可：模型定位已登记项目，明确执行意图后调用 submit_project_task，不改变 active。list_projects 的 callerProjectId 表示执行本次工具调用的项目，active 仍只表示微信导航选择；不应把后台执行项目误认为当前导航项目。

提交只接收文字，可信调用方、目标线程和有效工作目录由服务端绑定。复用 DurableJobs/DurableIntake，同一项目串行、不同项目独立；最多允许目标项目另有5条 pending 消息，超过后拒绝。工具回执 queued 仅表示持久入队并返回完整 taskId，不表示任务执行完毕。当前项目直接执行，避免自投递；接收到的项目任务不递归转发给其他项目。

本次提交的进度、审批提示、附件结果和恢复通知沿原 Presenter/OutputTransport 返回同一微信收件人，始终标注项目及任务短编号；不等待用户切换，不冲刷其他旧未读消息，也不把执行输出自动插入路由模型的线程。需要汇总时通过 taskId 只读查询。旧任务的投递策略、原命令和显式切换行为保留。

路由元数据与原队列任务一起保存，去重回执清理不改变已排队任务。排队期间目标变为不可用，或既有线程/目录变化时，执行前取消并说明未执行。插入结果未知时保留原 taskId 核对，不另起任务或自动重放；重启只恢复原队列记录和原轮次。停止当前入口不等于停止其他项目，必须明确目标后使用原停止流程。

本期不跨项目隐式转交用户附件；可靠语音转写可作为文字提交，文件原件与审批动作仍需明确归属。升级、重启由独立维护工具处理，不通过项目任务递归调用。

## 自然语言维护与命令覆盖

新增 get_service_status、get_installation_status、get_diagnostics、get_usage_guide、get_maintenance_status、request_service_restart、request_upgrade 和 request_project_archive。服务、安装验收与诊断都是只读且按当前账号装配；诊断不返回原始日志。归档/还原复用原 TextConversations 核对流程，忙碌、陈旧线程、最后一个可用项目及未知上游结果保持原保护。

重启和升级先保存意图、返回 MCP 回执，再安排原 AgentSwitcher/ChatUpgrader 工作进程；不在模型工具调用内停止服务。重启绑定当前账号；升级绑定共享安装并复用等待空闲、临时回滚数据、切换、回滚和健康检查；成功后删除临时数据。升级凭据同时绑定版本和提交，最新 Release 发生变化则不改装另一个版本。查询维护状态区分工作进程 waiting_idle/running/complete/failed 与管理操作 pending/scheduled/unknown；安排成功不是完成。

日常指南及首次连接提示以自然语言示例为主。项目、任务、计划、更新、会话和诊断管理统一走 MCP；只有停止、服务状态和安装帮助等应急兜底保留精确入口。计划、代码审查、普通文件工作等通过底座与已有跨项目任务入口处理，不添加通用 shell/RPC 工具。永久删除、原生会话重置/迁移、扫码、密钥输入及用户审批不由这批维护工具代办；人工恢复入口仍保留。

模型选择按项目保存于既有会话状态，普通消息及规划轮次从下一次提交生效，并在重新连接时应用。configured 仅表示偏好持久化，不代表实际推理验收成功。原生 review/start 不提供逐次模型参数，不保证独立审查同步切换。项目状态区分 configuredModel（保存的选择）与 connectedModel（最近建连时底座回执），后者不是每轮实际模型。

新增 get_project_progress 返回完成证据、当前任务、阻碍及排队后续；get_entry_routing_status 返回记录阶段、耗时、回退与实际识别模型；request_queue_change 仅取消或提前精确 pending 任务；request_queue_cancel_all 原子取消查询快照中的任务，任何已起跑任务会使整批拒绝，不影响之后新入队的任务。
