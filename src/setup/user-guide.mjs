export const USER_GUIDE=`微信助手使用说明

直接说需求即可，不需要先记命令、选择菜单或切换项目。助手理解意图后调用管理工具；同名项目或目标不明确时，会先核对。

## 首次连接

按 README 在安装电脑完成模型授权和微信登录。API 密钥只在本机终端输入，扫码与设备授权需由你本人完成。登录后会主动显示简明使用说明。

## 一个入口处理多个项目

- “现在有哪些项目？”
- “知识库项目做到哪一步了？”——查询进度，不切换、不创建任务。
- “让工具箱优化搜索页面，保持现有配色。”——明确的新任务进入目标项目队列。
- “给知识库正在执行的任务补充：需要支持 PDF。”——只补充指定原任务，不另起任务。
- “停止工具箱当前任务。”——核对项目和任务后请求停止，不影响其他项目。
- “查一下知识库上次的结果。”——只读结果；只有明确说“把原文件再发一次”才重发。

各项目保留自己的目录、上下文和队列。进度、审批提示和结果带项目与任务标识返回。排队表示已接受任务，不表示已经完成。后台结果不会自动写入当前模型上下文，需要汇总时助手会查询对应任务。语音有可靠文字转写时也可这样表达；跨项目提交目前仅支持文字，附件原件不会隐式转交。

## 项目、历史与计划

可以说“新建一个资料整理项目”“把知识库改名为资料库”“搜索知识库里关于搜索优化的讨论”“归档已结束的项目”或“还原知识库项目”。新建先确认已有目录，不自动切换；归档保留历史，不等于永久删除。归档当前项目时，导航会按原规则选择其他可用项目。

可以说“明天上午九点提醒我开会”“每天九点让知识库整理日报”“看看我的计划”“取消明天那个提醒”。时间、时区或项目不清楚时会先询问。取消计划只取消未来触发，不停止已经开始的任务。

## 版本与维护

- “看看有没有新版本。”——只检查，不安装。
- “这一个版本先不升级。”——仅跳过已核对的具体版本，后续版本仍可提醒。
- “升级到刚才查到的新版本。”——绑定该版本和提交，回执返回后交给原升级工作进程，等待共享安装中的服务空闲，再备份、升级和健康检查。共享安装中的账号会受影响；不会自动改装后来出现的版本。
- “重启当前账号的助手。”——回执返回后安排当前账号空闲重启，不停止正在运行的任务。
- “升级完成了吗？”——核对真实维护记录；已安排不等于已完成。

## 排查与其他工作

可以说“助手服务正常吗”“安装配置有什么问题”“看看最近的错误”“再介绍一下怎么用”。诊断仅返回当前账号脱敏信息，不展示原始日志、聊天正文或密钥；安装检查不等于本次模型推理成功。

写方案、代码审查、解释代码及其他工作直接说明目标与约束，由当前底座处理。管理 MCP 不提供任意 RPC、任意收件人或通用命令执行接口；也不代替用户批准敏感操作、输入密钥或扫码登录。

## 模型不可用时

精确命令仍由接入层处理，不依赖模型理解：

- **停止**：停止当前会话任务并清空其队列；其他项目需明确核对目标。
- **状态**：查看当前会话与任务状态。
- **安装帮助**：查看安装、授权与配置指引。
- **服务状态**、**使用说明**、**命令列表**：查询服务与完整人工操作入口。

其他人工恢复操作可发送“命令列表”查看。自然语言管理需要启用配套 MCP 与 Skill；被禁用或模型无法调用时，仍可使用精确命令。
`

export const USER_GUIDE_EN=`WeChat assistant user guide

Describe what you need in natural language. You do not need to memorize commands or switch projects first. The assistant clarifies ambiguous project names and targets before acting.

## First connection

Complete model authorization and WeChat sign-in on the installation computer as described in README. Enter API keys only in that terminal. Device authorization and QR confirmation remain user actions. A short guide appears after login.

## One entry, multiple projects

- “What projects do I have?”
- “How far has the knowledge project progressed?” — reads status without switching or creating work.
- “Have the toolbox project improve its search page, keeping the current colors.” — submits a new text task to that project.
- “Add PDF support to the knowledge project's running task.” — supplements the exact original task.
- “Stop the toolbox project's current task.” — verifies the target without stopping other projects.
- “Show the knowledge project's previous result.” — reads it; files are resent only on an explicit request.

Projects retain their own directories, context and queues. Labelled progress, approval prompts and results return to the same WeChat entry. Queued does not mean completed. Background results are not automatically inserted into the current model context; the assistant queries task results when asked to summarize. Reliable voice transcripts work as text. Cross-project submissions currently accept text only; attachments are not implicitly transferred.

## Projects, history and schedules

Ask to create or rename a project, search its discussions, archive a finished project or restore an archived project. Creation first confirms an existing directory and does not switch. Archiving preserves history rather than permanently deleting it. Archiving the current project moves navigation to another available project under the existing rules.

Ask for a reminder tomorrow, a recurring project task, your schedule list or cancellation of a specific reminder. Ambiguous times, time zones and targets are clarified. Cancellation stops future triggers, not tasks already submitted.

## Updates and maintenance

Ask whether a release is available to check without installing. Ask to skip that particular version to retain notifications for later releases. Explicitly requesting an upgrade binds the checked version and commit. After the tool receipt, the existing worker waits for the shared installation to become idle, then backs up, upgrades and checks health. Accounts sharing that installation are affected; a later release is not silently substituted.

Ask to restart the current account to schedule an idle restart after the tool receipt. Running work is not forcefully interrupted. Ask whether maintenance finished to inspect the worker's actual record; scheduled does not mean completed.

## Troubleshooting and other work

Ask whether the service is healthy, what is missing from installation, for recent errors, or how to use the assistant. Diagnostics expose only sanitized current-account information. Installation checks are not proof of a new successful inference.

Describe plans, code reviews and other work directly for the configured agent to handle. Management MCP exposes no arbitrary RPC, recipient or generic command execution interface. User approvals, API key input and interactive sign-in remain explicit user actions.

## When the model is unavailable

Exact commands remain handled by the bridge:

- **stop**: stop the current conversation and clear its queue; identify other projects explicitly.
- **status**: inspect current conversation and task status.
- **install-help**: installation and authorization guidance.
- **service-status**, **guide**, **help**: service status, this guide and the full manual command entry.

Send help for the full manual command entry. Natural-language management requires the enabled MCP and Skill; exact commands remain available if those are unavailable.
`

// First-login guidance emphasizes natural language; exact commands remain a fallback.
export function quickStartGuide(language='zh'){return language==='en'?"Getting started\n\n• Describe your task: ask for project progress or ask a named project to improve search.\n• No project switching is needed; labelled progress and results return here. Cross-project submission currently accepts text only.\n• Ask to check updates, upgrade to the checked release, or restart this account. Scheduled does not mean completed.\n• If the model is unavailable, stop, status and install-help remain available.\n• Ask how to use the assistant whenever needed.\n\nIf model setup is incomplete, rerun the installer on your computer and choose Configure model.":"使用说明 · 快速上手\n\n• 直接说需求，例如“知识库做到哪了”“让工具箱优化搜索页面”。\n• 无需切换项目；进度和结果带项目标识返回。跨项目提交目前仅支持文字。\n• 可以说“看看有没有更新”“升级到刚才的新版本”或“重启当前账号”。已安排不等于完成。\n• 模型不可用时仍可发送“停止”“状态”“安装帮助”。\n• 需要帮助时说“再介绍一下怎么用”。\n\n若尚未配置模型，请在安装电脑运行安装程序，选择“配置模型”。"}
