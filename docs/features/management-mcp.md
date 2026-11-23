# 自然语言管理：MCP + Skill

本期把既有项目、会话、结果、计划和更新管理 API 包装为一个本地 `zerolink-management` MCP 和 `zerolink-manage` Skill。模型负责理解自然语言和转写，服务端负责归属校验与执行。没有额外模型 API Key；仍使用账号已配置的底座和计费方式，订阅是否支持取决于该账号的 Codex 授权。本期仅接 Codex，不新增 Claude 底座，也不自行做语音识别。

## 使用

- “知识库做到哪了”：查候选、任务状态，必要时读历史；不切换项目。
- “切换到知识库”：唯一匹配后提交切换。当前回复结束后由既有连接用例核对目标，系统通知确认结果。
- “给知识库当前任务补充：需要支持导出”：绑定原任务和轮次提交，任务已结束时拒绝，不排到下一任务。
- “停止知识库当前任务”：停止指定原任务，并复用原取消流程清空其排队消息；请求已提交不等于确认停止。
- “有哪些模型”：只查询，不改模型。

同名项目会询问用户选择，无匹配不会扫描整个磁盘或创建项目。候选只来自当前账号下该用户已登记的会话，不是智能全文搜索；“知识库做到哪了”里的业务别称未命中时需澄清。查询不是执行授权，模型理解仍可能出错；精确的“切换”“补充”“停止”等原命令继续可用。

## 工具边界（共22项）

| 工具 | 输入要点 | 结果/边界 |
| --- | --- | --- |
| resolve_target | query | unique / ambiguous / not_found；只读，不切换 |
| list_projects | 无 | 当前用户已登记项目和日常会话 |
| get_project_status | projectId | 本地执行、队列、恢复状态、管理操作；不是项目完成度 |
| get_session_history | projectId、可选 cursor | 文本分块和绑定目标的续页，不重发附件 |
| list_models | 无 | 底座结构化模型列表；不切模型 |
| request_project_switch | projectId、requestId | pending；完成后独立通知 |
| supplement_task | projectId、taskId、turnId、text、requestId | 原任务 accepted / rejected / unknown 等回执 |
| request_task_stop | projectId、taskId、turnId、requestId | pending → requested；停止结果看原会话最终事件 |

| get_management_operation | operationId | 当前用户的具体管理操作回执，不重放 |
| list_workspace_choices | 来源 projectId | 当前目录及允许子目录，五分钟绑定凭据 |
| create_project | name、workspaceToken、requestId | 只创建记录，不切换、不建文件夹 |
| rename_project | projectId、name、requestId | 沿用命名用例，已有线程需底座确认 |
| search_session_history | projectId、query、可选 cursor | 最近最多50轮；返回范围、时间、位置与续页 |
| list_project_tasks | projectId、offset、limit | 完整持久 taskId；不暴露原请求正文 |
| get_task_result | projectId、可选 taskId、cursor | 只读文本分页和附件摘要；不发文件 |
| request_result_redelivery | projectId、resultToken、requestId | 绑定原快照，检查完整性/有效期后投递 |
| request_task_reconciliation | projectId、完整 taskId、requestId | 指定原任务核对，不重新执行 |
| check_updates | 无 | 只读版本信息、摘要及绑定版本的凭据 |
| skip_update | updateToken、requestId | 跳过确切版本，保留后来版本提示 |
| create_schedule | projectId、kind、text、at 或 repeat、requestId；可选 timeZone | 原计划服务保存，回传计划ID、时区和下次时间 |
| list_schedules | offset、limit | 当前用户计划、目标项目、状态和服务时间/时区 |
| cancel_schedule | scheduleId、requestId | 取消未来触发，不停止已提交任务 |


taskId、turnId 必须来自刚查询的任务状态，不能拿旧任务身份作用到下一轮。每次写操作生成新 UUID；同一操作重试保持原 requestId 和参数。相同编号不同参数报冲突。去重记录至少保留七天，未知操作保留至人工核对；查询 operations 可查看请求状态。历史单轮按时间顺序展示，每次返回最多 10,000 字符，nextCursor 继续该轮剩余文本或更早轮次，不丢弃超长内容。游标绑定用户、项目、线程并签名；服务重启后从第一页重查。

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

沿用 assistant-sessions.json 与 DurableJobs，无第二套会话/任务数据库。管理操作元数据保存在同一会话状态中；同一用户只允许一项待处理管理操作。未执行请求五分钟过期；重启将未激活操作标记 not_executed、执行中操作标记 unknown，绝不自动重放写操作。停止和切换先将 MCP 工具回执写到 stdio，再激活服务端操作；工具回执写出不证明用户已阅读。切换等待发起轮结束，后续显式选择会使旧请求失效。维护排空/封存期间不接收新操作，后台操作进入同一 runtime 忙闲计数。

运行状态只表示观察到的执行、排队和投递证据。停止 requested 不能证明子进程已全部退出；以原链路确认结果为准。目录来自本地配置时明确标注 local_configuration，切换成功通知仍用底座确认的 cwd。

## 验证

```sh
node --test tests/management/*.test.mjs
node src/tools/verify-management-native.mjs
```

第二条在临时 HOME/CODEX_HOME 中运行项目固定版本的真实 Codex，只创建空线程并检查 Skill 和 22 个 MCP 工具加载，不登录、不启动模型轮次、不访问生产账号状态。自动测试验证协议、身份、歧义、长历史、陈旧任务、去重和安装保护；不等于真实微信或跨平台人工验收。

## 第二批能力的约束

新建项目先取来源目录候选，凭据绑定用户、来源项目、真实根目录、目标目录和设备/inode，五分钟有效；创建前重新校验，不能把模型提供的任意路径当授权。目录选择不是操作系统沙箱。新建只落项目记录和 canonical workspace，不改变 active、不连接底座；后续切换需单独请求。日常会话使用 daily 标识定位。

结果查询不会走旧“结果”的重发分支。新结果保存完整任务/线程/轮次身份；旧记录采用明确的兼容身份。查询文本按最多10,000个字符分块，历史附件链接不作为新交付链接。指定持久任务可从其原线程只读核对历史文本，最近20份旧结果的文本和附件清单保存在同一会话状态中，重发查询窗口为7天；过期元数据在后续结果归档时清理，不另存文件字节。超出该范围、没有保留清单时 redeliveryAvailable=false，不猜测文件位置。最近结果的 resultToken 十分钟有效；提交重发时把确切快照冻结到同一管理操作中，之后即使新结果到达也不改发新结果。投递前验证全部附件的归属、保留期、大小和哈希；不可用则不先发文字、不重新生成。accepted 只表示现有投递接口的确认，不表示用户已阅读。

任务核对先按完整持久 taskId 验证归属和 uncertain 状态。空闲后仅将那一条记录送回既有恢复流程；不把 pending 新任务当作恢复对象，不调用 turn/start 重执行旧任务。恢复结果仍由原 DurableIntake/SessionManager 保存。项目状态附最近20条管理操作摘要；具体操作用 get_management_operation 查询。

搜索最多覆盖最近50轮，每次处理一个轮次或其中最多10,000字符；长文本跨片匹配保留接缝。每片最多返回20个命中摘要，并标记省略命中数量；complete/limited/nextCursor 说明实际覆盖边界，内容变化时拒绝旧续页而非静默漏读。

定时操作直接复用原 ScheduleService，服务端绑定目标项目而非接受任意 threadId。创建请求的去重身份与计划在同一计划状态中原子保存，重启后保持；返回时间为实际下一次触发，另给时区和本地显示。提醒与任务都保留来源项目，任务到期仍进入原持久队列。取消不撤回已经提交的任务，回执明确 futureTriggersCancelled、taskMayStillBeRunning 和 runningTaskStopped。

检查更新只读取已安装版本与正式 Release，沿用原版本比较规则。跳过凭据十分钟有效并绑定用户与确切版本；若期间已记录更新的版本，保留新版状态，只给旧版添加跳过偏好，不误将新版标记为 dismissed。
