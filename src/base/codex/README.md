# Codex 底座

protocol-client.mjs 是本机和远程共用的 JSON-RPC 客户端，负责请求编号、响应关联、超时、事件及服务端交互。协议消息只通过注入的 transport.send 发送，不在协议层选择主机或启动远端命令。

protocol-operations.mjs 提供初始化握手及 Codex 只读重试白名单。本机 CodexRpc 默认使用 stdio-transport.mjs 启动配置的本机 CLI，也接受注入传输。远程任务客户端注入 SSH/WebSocket 传输，使用同一个 CodexProtocolClient。

thread、turn、fs、backgroundTerminals 等操作统一走 request(method, params)。命令实际由对应连接背后的官方 app-server 执行；远端路径不会转换成微信主机上的本地 shell 命令。

远程重连时的会话恢复、任务归属和停止核验在 core/remote-tasks/；SSH 与隧道在 remote/。模型底座不负责授权另一个会话的任务。
