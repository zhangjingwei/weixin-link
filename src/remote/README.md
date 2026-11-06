# 远程连接

- ssh-transport.mjs：通过 SSH 接入官方 daemon proxy，或转发官方 app-server 的 loopback WebSocket；只负责连接和消息收发。
- reconnecting-connection.mjs：连接生命周期、有界退避、并发连接合并与显式关闭。连接后的初始化由上层回调提供，不包含 Codex 协议方法。
- remote-config.mjs、remote-paths.mjs：私有主机连接配置和运行目录。
- remote-codex.mjs、remote-rpc.mjs：旧路径的薄兼容入口，没有第二套协议或任务引擎。

统一协议在 base/codex/，任务协调在 core/remote-tasks/，远程安装部署在 setup/remote-deploy.mjs，真实验收脚本在 tools/remote/。
