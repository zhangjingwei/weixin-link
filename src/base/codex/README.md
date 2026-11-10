# Codex 底座

protocol-client.mjs 是本机和远程共用的 JSON-RPC 客户端，负责请求编号、响应关联、超时、事件及服务端交互。协议消息只通过注入的 transport.send 发送，不在协议层选择主机或启动远端命令。

protocol-operations.mjs 提供初始化握手及 Codex 只读重试白名单。本机 CodexRpc 默认使用 stdio-transport.mjs 启动配置的本机 CLI，也接受注入传输。SSH 远端操作由独立集成执行，不连接远端 Codex 协议。

provider-options.mjs 只负责 Codex 的模型与 CLI 选项；podman-rpc.mjs 只负责连接容器内的 Codex app-server。容器的创建、资源限制和账号隔离由 `src/infrastructure/runtime/container-environment.mjs` 负责，Codex 镜像与启动命令由 `src/setup/container-specs/codex.mjs` 提供。

thread、turn、fs、backgroundTerminals 等操作统一走 request(method, params)。命令实际由对应连接背后的官方 app-server 执行；远端路径不会转换成微信主机上的本地 shell 命令。

本机 Codex 协议不管理远端 SSH 主机；SSH 操作在 application/remote-tasks/ 和 infrastructure/remote/。
