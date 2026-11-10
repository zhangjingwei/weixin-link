SSH 远端操作由本机 Codex 指挥，部署设备通过 SSH 执行；远端无需 Codex。POSIX 主机使用 sh，Windows 主机使用 PowerShell；命令语法须与目标平台匹配。仅在当前用户明确授权远端操作时调用 `node src/integrations/cli.mjs call ssh-remote`，JSON 从标准输入传入，当前会话须设置 `CODEX_THREAD_ID`。

先用 `{"action":"list"}` 查看已配置主机，再以 `{"action":"inspect","host":"example","project":"/work/project"}` 检查目录。执行命令：`{"action":"exec","host":"example","project":"/work/project","command":"git status --short","timeoutMs":30000}`。读取文件：`{"action":"read","host":"example","project":"/work/project","path":"/work/project/README.md"}`，内容以 `data_base64` 返回。写入只创建新文件：`{"action":"write","host":"example","project":"/work/project","path":"/work/project/new.txt","data_base64":"..."}`。

命令由远端 shell 执行，可自行改变目录或操作其他路径；执行前应按用户授权限定目标。SSH 连接断开或超时时，命令可能已经执行，先核查远端状态，不要自动重试写操作。输出与单次文件内容最多 1 MiB；命令输出上限 64 KiB。
