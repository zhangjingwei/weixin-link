# SSH 连接

`ssh-transport.mjs` 从部署设备运行批处理 SSH 命令，使用严格主机密钥检查，并限制时长、输入和输出大小。SSH 凭据和主机别名保存在源码外的私有配置中。

`path-guard.mjs` 校验项目和文件路径。`host-config.mjs` 读取私有 `remote-hosts.json`；支持 POSIX 和 Windows 远端。Windows 使用 OpenSSH Server 和 PowerShell 执行命令。远端无需安装 Codex 或启动 app-server。
