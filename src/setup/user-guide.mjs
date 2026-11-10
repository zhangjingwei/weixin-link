export const USER_GUIDE=`微信助手使用说明

本说明使用中文命令。输入名称、需求和答案时可使用任意语言。

一、首次设置

1. 按 README 的步骤在电脑上运行安装命令。安装器会提示选择订阅登录、DeepSeek、Qwen 或 Kimi，并完成授权、连接检查和真实模型测试。第三方密钥只在终端输入，不要发到微信。
2. 安装器显示微信登录地址，并尝试打开浏览器。请在手机微信确认登录；若要求输入 PIN，请按同一终端的提示操作。登录后微信 Link 会主动推送连接结果。
3. 若跳过或未完成模型配置，重新运行安装命令，在菜单中选择“配置模型”。

- “安装向导”：返回本机终端向导的启动方法。

二、日常使用

直接发送文字、图片或文件，并说明需要助手做什么。引用一条消息提问时，助手会尝试读取被引用的文字；找不到时会提示。
需要输入名称、关键词或需求的命令分两步：先发送命令，收到提示后再用下一条纯文字回复。图片、文件和语音附件不能作为命令内容。
等待输入时，可以先发“使用说明”“状态”等查询命令；看完后继续回复原来的提示。

【对话与任务】

- “日常”：进入固定的日常会话。
- “补充”：按提示回复要补充的信息；任务结束后不能继续补充。
- “状态”：查看任务和发送状态。
- “进度”：查看当前处理进展。
- “结果”：查看最近一次结果；再次查看时，附件也可能重新发送。
- “停止”：停止当前任务并清空排队消息。
- “退出”：停止并断开当前会话，保留历史。
- “恢复”：核对已提交但结果未确认的任务。
- “取消”：放弃正在等待输入的命令。

【服务与说明】

- “命令列表”：查看可用命令。
- “使用说明”：重新查看本说明。
- “服务状态”：查看服务是否运行。
- “重启”：在当前账号空闲后重启服务。
- “升级”：在空闲后升级标准安装的版本；自定义部署可能无法使用。

也可以直接用自然语言安排提醒，例如“明天上午九点提醒我开会”。提醒可以只发送文字，也可以到点后执行指定任务。当前不读取手机日历；定时任务只在本机执行。

三、项目与日常

项目和日常会话都在同一个微信聊天窗口中使用。归档、还原、删除和切换时，先发送命令，再从回复的列表中选择序号。序号只用于这次选择。

- “列表”：查看项目列表。
- “日常”：切回日常会话。
- “新建”：按提示输入项目名。
- “命名”：按提示输入新名称。
- “切换”：显示日常和项目列表，回复前面的序号。序号每次从 1 开始，只用于这次选择。
- “历史”：先显示可查看的会话列表，再回复序号查看；已归档会话也会列出。
- “翻页”：查看更早的历史。
- “搜索”：按提示输入关键词，搜索当前会话最近 50 轮。
- “归档”：列出可归档的会话，回复序号后归档并保留历史。
- “还原”：列出已归档的会话，回复序号后还原。
- “删除”：列出可删除的会话，回复序号后永久删除该会话及其派生会话，无法还原。

四、任务、审查与会话

【任务与计划】

- “长任务”：按提示输入目标；之后仍需发送具体任务。
- “长任务状态”：查看目标状态。
- “暂停长任务”：暂停目标。
- “继续长任务”：继续目标。
- “完成长任务”：标记目标完成。
- “清除长任务”：移除目标记录。
- “计划”：按提示输入需求，先生成计划；看完后可另发明确的实施要求。

【代码审查】

- “代码审查”：检查当前工作区的未提交变更。
- “对比审查”：按提示回复分支名称，例如 main，检查与该分支相比的变更。
- “审查提交”：先显示最近的提交，再回复编号选择要审查的那次。

【会话管理】

- “会话状态”：查看当前会话和长任务状态。
- “恢复会话”：先显示会话列表，再回复编号切换。
- “重置会话”：为当前项目建立新会话。
- “压缩上下文”：整理当前会话。
- “分叉会话”：复制当前会话并切换过去。
- “旁支会话”：创建旁支，保留当前会话；以后可切换到旁支。

【模型与记忆】

- “模型”：查看模型列表。
- “开启快速模式”：让后续任务使用快速模式。
- “关闭快速模式”：关闭快速模式。
- “记忆”：查看记忆状态。
- “开启记忆”：开启当前会话的记忆模式。
- “关闭记忆”：关闭当前会话的记忆模式。

【交互答复】

助手要求审批或补充信息时，按提示使用对应编号：

- “批准”：显示待审批操作，回复编号同意其中一项。
- “拒绝”：显示待审批操作，回复编号拒绝其中一项。
- “回答”：显示待回答的问题，回复编号后再输入答案。

五、图片和文件

可以发送图片、文件、PDF 或视频，并告诉助手希望它做什么。如果内容无法完整读取，助手会在回复中说明。
助手也可以发送文件，每次最多 8 个，总大小不超过 50 兆。文件过大或无法接收时，请按提示处理。
发送的 MP3、WAV 音频会作为文件显示。请在微信私聊中使用，暂不支持普通微信群。

六、连接设备与备份

想连接其他电脑、家中设备或设置备份，直接告诉助手要做什么，再按回复中的提示操作。密码和密钥不要发到微信里。

七、遇到问题时

微信显示“无法连接”或助手没有按预期回复时，可以按情况发送：

- “服务状态”：查看服务是否在线。
- “诊断”：查看当前账号的诊断信息。
- “查看最近错误”：查看最近的错误提示。
- “导出诊断报告”：生成报告，便于请别人排查。
- “安装状态”：能收到消息但无法处理任务时，检查安装和登录设置。
- “状态”：不确定任务是否执行时，先查看状态。
- “结果”：核对最近一次结果，避免重复发送任务。
- “安装帮助”：查看安装方法。

八、在指定文件夹中工作

- “当前目录”：查看助手正在使用哪个文件夹。
- “新建项目”：先回复项目名，再从当前文件夹及其子文件夹列表中选一个。
- “停止”：只停止当前会话的任务。

多个项目可以使用同一个文件夹。如果同时修改同一个文件，内容可能冲突；请先确认其他任务是否还在处理。微信语音如果附带完整文字，也可以直接说命令。
`

export const USER_GUIDE_EN=`Weixin Link User Guide

Send English commands as plain text, without a slash. Commands are case insensitive. Names, requests, and answers can be in any language.

1. First-time setup

1. Follow the installation steps in README.en.md on your computer. In the terminal, choose subscription sign-in, DeepSeek, Qwen, or Kimi. The installer checks the connection and runs a model test. Enter third-party API keys only in the terminal.
2. The installer shows a WeChat login address and tries to open it in your browser. Confirm the login in WeChat on your phone. If asked for a PIN, follow the prompt in the same terminal. The assistant will send a connection message after login.
3. If you skipped or did not complete model setup, rerun the installer and choose Configure model from the menu.

- setup: Show how to start the setup wizard on your computer.

2. Everyday use

Send a message, image, or file and explain what you need. When you reply to a quoted message, the assistant tries to read its text and tells you if it cannot.
Commands that need a name, search term, or request work in two steps: send the command, then reply to its prompt with a separate text message. Images, files, and voice attachments cannot supply that input.
While a prompt is waiting, you can check guide or status and then continue with your original answer.

Conversations and tasks

- daily: Return to your everyday conversation.
- supplement: Reply to the prompt with more instructions for the current task.
- status: Check the task and message status.
- progress: Check the current progress.
- result: See the latest result. Attached files may be sent again when you request it again.
- stop: Stop the current task and clear queued messages.
- exit: Stop and disconnect the current conversation while keeping its history.
- recover: Check a submitted task whose result is still uncertain.
- cancel: Cancel a command that is waiting for your input.

Service and help

- help: List available commands.
- guide: Show this guide again.
- service-status: Check whether the service is running.
- restart: Restart this account's service when it is idle.
- upgrade: Upgrade a standard installation when it is idle. Custom deployments may not support this command.

You can also ask for a reminder in ordinary language, such as “Remind me about the meeting tomorrow at 9 AM.” A reminder can send a message or start a scheduled task. It runs on the computer and does not read your phone calendar.

3. Projects and the everyday conversation

Projects and the everyday conversation share one WeChat chat. For archive, restore, delete, and switch, send the command first, then reply with a number from its list. The number applies only to that selection.

- list: List projects.
- daily: Return to the everyday conversation.
- new: Enter a name for a new project when prompted.
- rename: Enter a new name when prompted.
- switch: Show conversations, then reply with the number of the one to use.
- history: Show conversations, including archived ones, then reply with a number to read its history.
- older: See earlier history.
- search: Enter a term to search the latest 50 turns of the current conversation.
- archive: List conversations you can archive, then reply with a number. History is kept.
- restore: List archived conversations, then reply with a number to restore one.
- delete: List conversations you can delete, then reply with a number to permanently delete one and its derived conversations. This cannot be undone.

4. Tasks, reviews, and conversations

Long-running goals and plans

- goal: Enter a long-running goal when prompted. Send specific tasks separately.
- goal-status: Check the goal's status.
- goal-pause: Pause the goal.
- goal-resume: Resume the goal.
- goal-complete: Mark the goal complete.
- goal-clear: Remove the goal record.
- plan: Enter a request to make a plan first. After reviewing it, send a separate request to carry it out.

Code reviews

- review: Review uncommitted changes in the current workspace.
- compare: Enter a branch name, such as main, to review changes against that branch.
- commit-review: Show recent commits, then reply with the number of the commit to review.

Conversation management

- session-status: Check the current conversation and goal status.
- resume-session: Show saved conversations, then reply with a number to switch to one.
- reset-session: Start a new conversation for the current project.
- compact: Condense the current conversation context.
- fork: Copy the current conversation and switch to the copy.
- branch: Create a branch while keeping the current conversation active. You can switch to the branch later.

Models and memory

- models: List models.
- fast-on: Use fast mode for later tasks.
- fast-off: Turn off fast mode.
- memory: Check memory status.
- memory-on: Enable memory for the current conversation.
- memory-off: Disable memory for the current conversation.

Approvals and answers

When the assistant asks for approval or more information, choose an item from the list:

- approve: Show pending approvals, then reply with a number to approve one.
- reject: Show pending approvals, then reply with a number to reject one.
- answer: Show pending questions, reply with a number, then enter your answer.

5. Images and files

Send images, files, PDFs, or videos and explain what you want done. The assistant will tell you if it cannot read the content in full.
The assistant can send up to 8 files at once, with a combined size of 50 MB. Follow its prompt if a file is too large or cannot be received.
MP3 and WAV audio is shown as files. Use a private WeChat chat; ordinary group chats are not supported.

6. Other computers and backups

To connect another computer or home device, or to set up backups, describe what you want and follow the assistant's reply. Do not send passwords or API keys through WeChat.

7. Troubleshooting

If WeChat says it cannot connect or the assistant does not respond as expected, use the relevant command:

- service-status: Check whether the service is online.
- diagnose: Check diagnostics for the current account.
- recent-errors: See recent error messages.
- export-diagnostics: Create a report to share for troubleshooting.
- setup-status: Check setup and sign-in if messages arrive but tasks do not run.
- status: Check whether a task is running.
- result: Check the latest result before sending a task again.
- install-help: Show installation help.

8. Working in a chosen folder

- folder: See which folder the assistant is using.
- new-project: Enter a project name, then choose the current folder or one of its subfolders from a list.
- stop: Stop only the current conversation's task.

Projects can share a folder. If they edit the same file at the same time, their changes may conflict; check whether another task is still running. A voice message with a complete text transcript can also contain a command.
`
