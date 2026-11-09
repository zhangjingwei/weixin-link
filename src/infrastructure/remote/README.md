# 远程连接

- ssh-transport.mjs：通过 SSH 接入官方 daemon proxy，或转发官方 app-server 的 loopback WebSocket；只负责连接和消息收发。
- reconnecting-connection.mjs：连接生命周期、有界退避、并发连接合并与显式关闭。连接后的初始化由上层回调提供，不包含 Codex 协议方法。
- host-config.mjs、workspace.mjs：私有主机连接配置、每次操作的配置快照和运行目录。
- path-guard.mjs：远程项目和导出路径的本地边界检查。
- 远程项目选择与任务执行会逐级检查授权根目录下的实际目录；符号链接目录被拒绝，避免通过路径别名越界。
- `src/remote/remote-codex.mjs`、`src/remote/remote-rpc.mjs`：已公开路径的薄兼容入口，没有第二套协议或任务引擎。

任务账本仍位于既有工作目录的 `remote-sessions.json`；多个账号共用工作目录时，记录带账号归属，非默认账号的会话范围单独命名。归属不明的旧记录会阻止对应会话继续操作，等待人工核对。远程操作使用固定的主机配置快照；配置写入与操作共用 `host-config` 锁。若旧版插件在自定义配置目录留下另一份账本，操作会报错并等待人工核对，不自动迁移或覆盖。

统一协议在 base/codex/，远程 RPC 适配在 infrastructure/agents/，任务协调在 application/remote-tasks/，远程安装部署在 setup/remote-deploy.mjs，真实验收脚本在 tools/remote/。
