# Remote host configuration

Copy `remote-hosts.example.json` to ignored `remote-hosts.json` and replace all example values. An absent file registers no hosts. `WECHAT_REMOTE_HOSTS` selects an external JSON file; `WECHAT_SSH_CONFIG` selects the SSH config. `remote-hosts.json` separates host settings from the shared lifecycle. SSH credentials remain exclusively in `~/.ssh/wechat_hosts_config` and never belong in this JSON.

- `platform`: `posix` or `win32`; selects path containment, instruction discovery and artifact paths.
- `binary`, `root`: installed Codex and allowed project root.
- `transport`: `daemon-proxy` for an existing Unix daemon; `ssh-websocket` for an existing official app-server bound to remote loopback.
- `port`: remote loopback port for `ssh-websocket`. The adapter opens an ephemeral local SSH forward, uses existing key/host verification, and closes only its own tunnel. SSH keepalive/reconnect and write reconciliation remain shared.

Windows 主机需配置实际用户目录、Codex 路径和 loopback 端口。官方 app-server 应以登录用户身份运行，不能以 SYSTEM 身份暴露到局域网或公网。注销、休眠或服务故障均可能导致不可达；适配器不自动重装、重启或重放结果不明的写请求。

`/stop` uses the original account/conversation scope: seal submissions, interrupt the owned turn, terminate only its owned background terminals, then verify they disappeared. It never stops the shared app-server. A tunnel disconnect is not proof of cancellation.

Host name recognition remains in `targets.json`. Register aliases there after SSH and app-server verification. New hosts with an existing supported endpoint require configuration, not another cancellation implementation.


## Reusable deployment

Run from the existing adapter directory:

```sh
node remote-deploy.mjs remote-windows
node remote-deploy.mjs remote-windows --check
```

The first command uses `remote-hosts.json` plus the existing SSH alias. It verifies the installed binary and login, checks the ownership of the fixed scheduled task and loopback listener, writes the hidden-launch scripts beneath that SSH user's `.codex/wechat-adapter`, and creates/updates the same `WeChatCodexAdapter` task. It starts the task only if no expected listener exists. Existing servers are never restarted and active turns are never cancelled. Changing the port while that task is running is refused rather than starting a second instance. Script or action updates take effect at the next launch without interrupting the current server. Repeated identical deployments report `changed:false` and keep the same listener PID. A port/task ownership conflict stops deployment without taking over another service.

`--check` only verifies the official RPC connection through the shared adapter. For Unix hosts the command is also connection-only: keep using the official daemon setup rather than installing this Windows launcher. The deployment helper is an on-demand script, not a daemon, queue, task engine or new service-management system. SSH authentication is never embedded in generated files. It does not install Codex, log in for the user, add SSH keys, or reboot the machine.

Windows uses `wscript.exe` with a hidden `powershell.exe` child so the official app-server does not open a terminal window. The task starts at the user's logon, under that same user, with no SYSTEM account or elevated task privileges. It requires Windows Script Host and an interactive user logon; if blocked by system policy, deployment fails instead of bypassing it. Service auto-recovery and logged-out execution are not introduced.
