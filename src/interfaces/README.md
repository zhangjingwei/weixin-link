# 接口层

目标架构中的 Controller 与 View / Presenter 位于此目录。Controller 接受微信、定时器、更新检查或管理 CLI 的输入，调用既有应用与基础能力；不另建收件、任务、会话或投递状态。

- `controllers/wechat-controller.mjs`：微信 SDK 回调、游标前检查和原消息捕获。
- `controllers/schedule-controller.mjs`：计划 API 请求与到期触发，委托 `ScheduleService` 保存状态，提醒走 Presenter，任务走共享持久队列。
- `controllers/update-controller.mjs`：定时版本检查入口，委托 `UpdateNotifier` 去重和保存投递状态。
- `controllers/management-controller.mjs`：聊天中的安装、切换和升级指令，以及配置 CLI 的参数入口。
- `views/wechat-presenter.mjs`：收件人映射、系统通知格式和微信投递入口。
- `wechat/voice-text.mjs`：从微信消息字段提取转写文字和附件指令上下文，供应用层使用。

`src/wechat/bot.mjs` 仍是每账号服务的组合根；`src/setup/setup.mjs` 仍是安装 CLI 入口。底层微信协议、计划状态机、更新比较和配置存储留在原模块，由接口层调用。
