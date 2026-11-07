# 配置与安装维护

日常配置直接在微信说明需求，例如“帮我配置远程主机”“检查家庭设备连接”或“创建第二个机器人账号”。智能体查询现状、校验参数和连接，再调用管理命令处理，无需用户使用 IDE、nano 或手工编辑运行 JSON。

自然语言配置需要模型可用；安装向导、登录和中文诊断入口由代码处理，不依赖模型。首次建立微信连接、扫码及外部账号授权由用户完成。

## 安装来源与目录

仓库已公开，Linux/macOS 使用 `bootstrap.sh`，Windows x64 使用 `bootstrap.ps1`。README 提供可匿名下载的一行安装命令；也可克隆 `main` 后运行 `./install.sh` 或 `.\install.ps1`。

两个引导脚本默认下载 `main`，支持 `WEIXIN_LINK_DIR` 指定源码保存目录、`WEIXIN_LINK_REF` 指定分支、标签或提交。默认源码目录为 `~/.local/share/weixin-link/source`；Windows 对应用户目录下的 `.local\share\weixin-link\source`。目标目录已存在时先识别已有安装：未登录则刷新二维码，由引导脚本直接解析结果、显示中文提示并在本机桌面打开 PNG（兼容不支持 `--human` 的旧安装），已在线则提示已登录；不覆盖源码、不重装。无法识别的目录仍拒绝覆盖，不自动更新已有部署。Windows 安装子进程使用临时执行策略，不修改系统或用户的持久执行策略。

旧版 `ZERO_LINK_DIR`、`ZERO_LINK_REF` 仍兼容，新变量优先。改名不迁移现有工作区、账号数据或服务；旧源码目录若已存在，先核实原安装再更新。

不同目录分别承担不同用途：

| 用途 | 默认位置 |
| --- | --- |
| 引导脚本下载的源码 | `~/.local/share/weixin-link/source` |
| 智能体工作区 | `~/work/wechat-assistant` |
| 安装配置 | `~/.local/share/wechat-ping-bot/installation.json` |
| 默认微信账号数据 | `~/.local/share/wechat-ping-bot` |
| 其他微信账号数据 | `~/.local/share/wechat-ping-bot/accounts/<id>/` |
| HA 与备份私有配置 | `~/.config/wechat-assistant/` |

Git 手动安装的源码位置是克隆目录。工作区和 Codex 路径由安装配置确定，不随下载目录自动变化。安装器保留已有工作区 AGENTS.md 的用户内容，仅更新明确标记的程序管理区块；更新后新会话才能读取新规则。

## 微信操作

- `安装向导`：按当前步骤选择运行环境、安装、登录及验证。
- `安装状态`、`安装智能体`、`登录智能体`、`验收智能体`：独立安装维护入口。
- `运行诊断`、`服务状态`、`查看最近错误`、`导出诊断报告`：查询当前账号诊断和服务状态，不调用模型。
- 远程主机、HA、备份与多账号：用自然语言说明需求，由智能体执行下方底层接口。

微信在线只代表通道建立。向导可发起一次真实模型测试；协议检查与实际推理分别报告结果。多账号需分别扫码，不复制已有凭据或授权名单。

安装脚本默认显示中文步骤、完成状态和扫码提示。供程序调用的 `src/setup/setup.mjs` 和 `src/wechat/account-manager.mjs` 保留原有 JSON 输出；安装相关命令可追加 `--human` 获取易读输出，例如 `./wechat-setup qr --human`。

## 二维码维护

终端半格字符有断缝时，可试用完整色块模式。它使用黑白背景色与空格绘制，不依赖 `▀`、`▄` 字形，但需要更大的终端窗口：

```sh
WEIXIN_LINK_QR_STYLE=full /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

若已解绑而服务仍在运行，可同时加 `WEIXIN_LINK_RELOGIN=1`。`WEIXIN_LINK_QR_STYLE=compact` 为原紧凑模式（默认）。完整模式同样兼容旧版安装，无需先升级服务；宽度不足时会显示需要的列数。请确保整个二维码及白边都在屏幕内。

**已经在微信解绑，但脚本仍提示本地服务就绪？** 本地进程状态不能证明服务端绑定有效。使用显式重新登录入口，等待任务结束、安全停止账号后重新扫码：

```sh
WEIXIN_LINK_RELOGIN=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

本地脚本对应 `./qr.sh --relogin` 或 `./qr.sh --relogin bot2`。不会删除账号档案或改绑另一个微信账号；如无法安全停止服务，操作失败并保留现有状态。旧部署的原停止命令若不支持当前运行状态，需要先按该部署的维护流程停止服务。

Linux/macOS 推荐使用独立入口，无需切换到安装目录：

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

也可在源码目录运行 `./qr.sh`，或 `./qr.sh bot2` 刷新已创建的指定账号。远程一行命令可通过 `WEIXIN_LINK_ACCOUNT=bot2` 选择账号，通过 `WEIXIN_LINK_DIR=/实际源码目录` 选择自定义安装。未指定目录时识别标准路径与旧版 zero-link 路径；若两者同时存在则要求指定目录。脚本不会安装依赖、升级源码或停止在线账号。SSH 或无图形界面的交互终端会显示当前有效的字符二维码，可直接扫码；终端过窄时提示放大窗口，并始终保留 PNG 路径。若字体行距造成断缝或扫码失败，可下载 PNG 扫码。有图形环境的本机终端会尝试自动打开图片。

Linux/macOS 在安装源码目录运行 `./wechat-setup qr`，再次显示当前二维码。使用引导脚本默认目录时先运行 `cd ~/.local/share/weixin-link/source`。

本机 macOS 或 Linux 图形桌面安装时会自动打开 PNG 二维码，避免终端字体、行距造成变形或断缝。若未自动打开，可手动打开输出的 PNG 路径。SSH 会话不会自动打开图片；终端过窄时跳过字符二维码，仍输出图片路径。

二维码过期且尚未建立微信通道时，由安装维护终端刷新默认账号：

```sh
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/wechat/account-manager.mjs refresh-qr default
```

Windows 使用安装时准备的 Node.js，从源码目录调用同一账号工具；仅安装了私有 Node 时，可执行：

```powershell
& "$HOME\.local\share\wechat-ping-bot\tools\node\node.exe" src/wechat/account-manager.mjs refresh-qr default
```

已在线账号拒绝刷新。二维码采用 90 秒保守本地展示窗口，服务端报过期或配对退出后不继续交付旧码。微信通道建立后，其他账号的创建和二维码交付可直接委托智能体完成。

## 智能体与维护者接口

以下是源码目录下的底层接口，不是用户在微信中需要记忆的英文命令。运行时需使用 Node.js 24+；Linux/macOS 若只安装了私有 Node，先将其 bin 目录加入当前命令的 PATH，或通过 `./wechat-setup` 调用配置入口。

```sh
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-check ha < /path/to/private-ha.json
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/setup/setup.mjs config-status
node src/setup/setup.mjs config-restore ha
```

类型支持 `installation`、`ha`、`backup`、`remote-hosts`。schema 返回格式；check 校验输入；set 检查连接和运行条件后原子写入并保留上一版；status 返回配置状态；restore 重新校验并恢复上一版。配置通过标准输入提供，不将令牌放入命令参数。

Claude 适配器通过 `installation` 配置选择：在保留现有 `workspace` 的前提下设置 `agentBackend: "claude"` 和 `claudeBinary`（官方 CLI 的绝对路径，版本 2.1.259+）。配置接口会检查 CLI 版本，并要求服务停止后才更改安装配置；切换后 Claude 会话状态独立保存，不移用 Codex 会话。运行服务还需获得 Anthropic Console 的 `ANTHROPIC_API_KEY` 或受支持云提供商凭据；密钥不写入安装 JSON，也不在微信发送。Claude 模式下“安装状态”只检查 CLI 路径与凭据是否存在，不等于真实推理验收。功能边界见 [Claude 接入说明](src/base/claude/README.md)。

服务运行后可在微信发送“切换智能体”查看当前账号底座，发送“切换智能体 Codex”或“切换智能体 Claude”安排空闲切换。Claude 需要先在安装配置中设置 CLI 路径，并向服务环境提供 API 凭据；Codex 需要已安装且登录。切换只影响当前微信账号，保留各底座原有会话，不迁移会话 ID。切换会重启该账号服务；完成后再次发送“切换智能体”核对实际运行底座。安装配置中的 `agentBackend` 仍是未指定账号选择时的默认值。

安装工作区不能直接迁移。存在运行实例时，安装路径配置需先停服务；远程主机有未对账任务时，删除或改变目标会被拒绝。恢复配置同样遵守这些检查。

多账号入口为 `node src/wechat/account-manager.mjs`，支持 `list`、`create`、`login`、`refresh-qr`、`qr`、`start`、`stop`、`verify`。`qr` 导出可交付文件；`stop` 等待指定账号空闲后停用，不影响其他账号。

## 远程主机与可选集成

- **远程主机**：私有工作区 `remote-hosts.json` 使用 `version: 1` 和 `hosts` 对象；每个主机包含 `platform`、`binary`、`root`、`transport`，`ssh-websocket` 另需 `port`。兼容旧版主机映射格式。用 config-schema 查看完整规则。
- **SSH**：`WECHAT_SSH_CONFIG` 指定配置文件，默认 `~/.ssh/wechat_hosts_config`。示例见 [SSH 配置模板](config-templates/ssh-config.example)，保持主机密钥校验。
- **HA**：智能体参考 [HA 模板](config-templates/ha.example.json)，通过配置接口写入 `~/.config/wechat-assistant/ha.json`；还需运行 `node src/integrations/cli.mjs enable home-assistant <账号>` 显式启用，当前仅支持只读查询。旧凭据路径继续兼容，新账号不继承启用状态；详见 [集成说明](src/integrations/README.md)。
- **备份（Linux）**：智能体参考 [备份模板](config-templates/backup.example.json)，通过配置接口写入 `~/.config/wechat-assistant/backup.json`；目标、加密公钥及远端私钥独立准备。

运行时可通过 `WECHAT_REMOTE_HOSTS`、`WECHAT_BACKUP_CONFIG` 指向外部配置；配置管理接口不接管自定义路径，遇到不一致时返回 `CONFIG_CUSTOM_PATH_UNMANAGED`。远程工作区可用 `WECHAT_REMOTE_WORKSPACE` 指定。

项目定位由智能体结合请求和实际目录处理，主机注册与允许根目录只限定执行边界。远程连接入口见 [远程连接文档](src/remote/README.md)，无需向私有工作区复制执行脚本。

## 升级与验证

已有部署先核实源码、工作区和服务实际路径，再安排更新；保留账号数据、AGENTS.md、远程会话记录和 outputs，不直接覆盖运行目录。服务入口位于 src/，由安装器按真实路径生成。Windows 已有任务配置不一致时明确拒绝覆盖，需要单独核对迁移。

远程验收脚本需要指定主机和专用测试项目，会执行真实任务；登录、发送消息、服务重启和容器切换按用户授权进行。检查通过与真实收发验收分别报告，见 [贡献指南](CONTRIBUTING.md)。

## 私有数据与发布检查

SSH 私钥、HA 令牌、微信/Codex 凭据、聊天记录、附件、状态数据库和本地配置不进入源码或发布包。模板仅含脱敏示例，不自动启用集成，也不提供维护者的账号权限。

提交前暂存拟发布内容，再运行 `npm run check:release`。它检查暂存区路径和常见密钥格式，不替代人工检查、依赖审查或 Git 历史审计。不要直接压缩整个运行目录；公开发布前独立审计历史，发现凭据泄露时先撤销或轮换。


## 已有安装与独立升级

安装入口先检查当前用户的 systemd 服务、macOS LaunchAgent 或 Windows 计划任务。已有服务即使采用不同源码目录或自定义服务配置，也不会触发重复安装、覆盖服务或自动升级。服务运行状态不等于微信登录状态。未运行的标准 Linux 安装仍可通过 bootstrap 刷新扫码；其他已注册部署可使用原安装目录中的配对命令恢复登录。

标准安装使用独立升级入口：

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/upgrade.sh)"
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/upgrade.ps1')))
```

`WEIXIN_LINK_DIR` 指向已安装源码目录，`WEIXIN_LINK_REF` 可选择目标分支、标签或提交（默认 `main`）。升级不会运行安装向导或重新扫码。先在旁边的暂存目录安装依赖，再通过控制接口确认所有已注册账号空闲，停止原先运行的服务，备份源码和运行数据，切换源码，恢复原先运行的服务并检查微信通道就绪。原先停止的账号保持停止。服务定义和覆盖配置、工作目录、Node 工具目录保持原样。

切换或就绪检查失败时，自动恢复旧源码与运行数据后启动旧版。备份保存在源码目录旁的 `.backup-*` 和 `~/.local/share/weixin-link/upgrades/`，其中运行数据可能含凭据，应按私密备份保存。回滚未能确认成功时保留升级锁和 `upgrade.json` 恢复记录，不继续尝试覆盖。突然断电或强制终止进程不会执行自动回滚，应由维护者依据记录恢复；不要直接删除锁重新升级。

自动升级仅适用于安装器管理、服务实际指向所选源码目录、支持维护控制接口的标准安装。Git 工作区、自定义 `.env`、运行数据位于源码目录内、未托管服务、服务覆盖配置指向另一个版本目录等情况会在切换前退出。自定义部署应使用自身发布流程升级，或先制定迁移方案；此入口不会擅自更改其模型提供方配置、启动参数或版本选择。Windows 平台流程需要在 Windows 上验证，其他平台的测试不能替代真实 Windows 服务验收。

## 配置写入锁恢复

配置写入使用带心跳的 `.write-lock`：每 10 秒续期，30 秒未续期后可由下一次写入回收。进程异常退出留下的锁不会永久阻止配置修改；仍有效的锁返回 `CONFIG_BUSY`，不抢占活跃写入。恢复操作同样遵守此锁与原配置摘要检查。升级时避免新旧版本配置写入程序同时运行；不要手动删除活跃锁。
