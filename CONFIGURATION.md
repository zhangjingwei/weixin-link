# 配置与安装维护

日常配置直接在微信说明需求，例如“帮我配置远程主机”“检查家庭设备连接”或“创建第二个机器人账号”。智能体查询现状、校验参数和连接，再调用管理命令处理，无需用户使用 IDE、nano 或手工编辑运行 JSON。

自然语言配置需要模型可用；首次安装的终端向导、登录和中文诊断入口由代码处理，不依赖模型。首次建立微信连接及外部账号授权由用户完成。

## 安装来源与目录

仓库已公开，Linux/macOS 使用 `install.sh`，Windows x64 使用 `install.ps1`；各平台安装和升级均复用自己的同一入口。README 提供可匿名下载的命令。克隆源码后，本地安装步骤分别位于 `src/setup/unix-install.sh` 和 `src/setup/windows-install.ps1`。

两个入口默认下载 GitHub 最新正式 Release；开发者可用 `WEIXIN_LINK_REF=main` 跟随主干，也可指定分支、标签或提交。`WEIXIN_LINK_DIR` 指定源码保存目录，默认 `~/.local/share/weixin-link/source`；Windows 对应用户目录下的 `.local\share\weixin-link\source`。目标目录已存在时会识别安装并显示菜单，可选择升级、配置模型、重新登录、添加账号或卸载；无法识别的目录仍拒绝覆盖。菜单中的维护操作使用现有本地安装，不下载新版本。卸载移除程序和后台服务，保留账号数据及工作区。Windows 安装子进程使用临时执行策略，不修改系统或用户的持久执行策略。

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

Git 手动安装的源码位置是克隆目录。工作区由安装配置确定；Codex CLI 从当前项目依赖目录启动。安装器保留已有工作区 AGENTS.md 的用户内容，仅更新明确标记的程序管理区块；更新后新会话才能读取新规则。

## 微信操作

- `安装向导`：告知终端向导的启动命令；模型配置在安装电脑完成。
- `安装状态`、`安装智能体`、`登录智能体`、`验收智能体`：运行时检查和验收入口。Codex CLI 随项目依赖安装，无需单独安装。
- `运行诊断`、`服务状态`、`查看最近错误`、`导出诊断报告`：查询当前账号诊断和服务状态，不调用模型。
- 远程主机、HA、备份与多账号：用自然语言说明需求，由智能体执行下方底层接口。

微信在线只代表通道建立。终端向导会进行一次真实模型测试，微信首次消息会报告已验证或待配置。多账号需分别登录，不复制已有凭据或授权名单。

安装脚本按终端语言显示中文或英文步骤、完成状态和微信登录提示。首次安装由 `install.sh` 发起微信登录，显示 HTTPS 地址并尝试打开浏览器。供程序调用的 `src/setup/setup.mjs` 和 `src/setup/account-manager.mjs` 保留 JSON 输出；底层命令可追加 `--human` 获取易读输出。

## 微信登录维护

首次安装会在电脑终端显示微信登录地址，并在有图形桌面时尝试打开浏览器。请在手机微信中确认；若要求 PIN，在同一终端输入。登录地址只在当前配对期有效，不要分享。

需要重新登录时，重新运行 README 中的安装命令，在菜单中选择“重新登录微信”。安装器会等待当前任务结束，安全停止该账号服务，再获取新的登录地址；无法确认停止时会保留原状态。添加其他微信账号则选择“添加微信账号”，按提示输入账号名，然后完成登录。

SSH 或无图形界面时不会尝试打开远端浏览器，终端仍会显示登录地址，可在自己的设备上手动打开。若微信服务没有返回可用的 HTTPS 地址，安装器会报错；不会展示字符二维码或 PNG 文件路径。登录地址采用 90 秒的保守本地有效窗口，实际有效期以微信服务端为准。

自定义安装目录可在执行安装命令时设置 `WEIXIN_LINK_DIR=/实际源码目录`。Windows 同样重新运行 `install.ps1`，在菜单中选择对应操作。

## 智能体与维护者接口

以下是源码目录下的底层接口，不是用户在微信中需要记忆的英文命令。运行时需使用 Node.js 24+；Linux/macOS 若只安装了私有 Node，先将 `$HOME/.local/share/wechat-ping-bot/tools/node/bin` 加入当前命令的 PATH。

```sh
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-check ha < /path/to/private-ha.json
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/setup/setup.mjs config-status
node src/setup/setup.mjs config-restore ha
```

类型支持 `installation`、`ha`、`backup`、`remote-hosts`。schema 返回格式；check 校验输入；set 原子写入并保留上一版；status 返回配置状态；restore 重新校验并恢复上一版。`remote-hosts` 写入时只校验格式，不连接主机；启用集成或使用主机时检查连接。配置变更从下一次调用生效。其他配置类型保留各自的连接或运行条件检查。配置通过标准输入提供，不将令牌放入命令参数。

`installation` 配置只接受工作目录等安装字段。Codex CLI 随 `npm ci` 安装并从本项目依赖目录启动。旧安装配置含已删除字段时，先停服务，再通过 `config-set installation` 写入同一 `workspace`；配置入口会校验工作目录不变。旧底座会话和任务不迁移。微信发送“重启”可在当前账号空闲后安排服务重启。

项目启动 Codex 时为每个微信账号档案设置独立的 `CODEX_HOME`：默认账号位于账号数据目录的 `codex-home/`，其他账号位于各自 `accounts/<档案 ID>/codex-home/`。档案 ID 与已绑定的微信账号对应，重启和重新登录后路径保持稳定。项目不会读取用户原有 `~/.codex` 的登录、配置或会话；升级到此版本后，每个账号需在自己的入口重新登录，原目录的 Codex 会话不会自动迁入。

### Codex 模型接入

首次安装在终端运行交互向导，选择订阅登录、DeepSeek、Qwen 或 Kimi，完成授权或密钥配置、Codex 连接检查及一次真实模型测试，随后才显示微信登录地址。安装提示按终端语言环境自动选择中文或英文，可用 `WEIXIN_LINK_LANG=zh|en` 覆盖；`C`/`POSIX` 等无法判定语言的环境默认中文。向导选择的语言会用于首次微信连接通知。当前 Codex 自定义提供商使用 **Responses API**；仅声称兼容 OpenAI Chat Completions 的接口不足以接入。第三方密钥只在本机终端录入，保存到对应账号的私有 `codex-provider.json`。订阅登录保留为独立选项；切回订阅时终端向导清除第三方配置。非交互式安装会跳过模型设置，之后重新运行安装命令并在菜单中选择“配置模型”。已有服务运行时重新执行向导，验证成功后会安排该账号空闲时重启以加载新配置。微信连接后主动推送安装验收结果；投递结果不确定时不自动重发。请勿把密钥发到微信。

| 接入方式 | 本项目配置的模型 | 接口依据 |
| --- | --- | --- |
| 订阅登录 | 账号可用的 Codex 模型 | [OpenAI Codex 登录说明](https://learn.chatgpt.com/docs/auth) |
| DeepSeek | `deepseek-flash`；官方另列 `deepseek-v4-pro` | [DeepSeek Codex 集成说明](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/) |
| 阿里云百炼按量付费 | `qwen3.7-max`，华北 2（北京）Workspace | [百炼 Codex 配置](https://help.aliyun.com/en/model-studio/codex) |
| Kimi 国际平台 | `kimi-k3.1-pro` | [Kimi Codex 集成说明](https://platform.kimi.ai/docs/guide/codex-kimi) |

百炼 Token Plan 的 `auto` 路由也使用 Responses，但本向导当前未接入；Coding Plan 文档使用旧版 Codex 的 Chat Completions 接口，不适用于本项目的 Codex 版本。Kimi 预设使用国际平台 `platform.kimi.ai` 的密钥及 `api.moonshot.ai/v1` 接口，不适用于中国平台密钥。以上属于接口与配置兼容性，最终推理和工具调用仍需用向导中的真实模型测试确认。参考：[OpenAI Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

安装工作区不能直接迁移。存在运行实例时，安装路径配置需先停服务。远程主机配置从下一次 SSH 操作起生效。

多账号入口为 `node src/setup/account-manager.mjs`，支持 `list`、`create`、`login`、`refresh-qr`、`start`、`stop`、`verify`。登录地址仅在安装电脑终端显示；`stop` 等待指定账号空闲后停用，不影响其他账号。

## 远程主机与可选集成

- **远程主机**：私有工作区 `remote-hosts.json` 使用 `version: 1` 和 `hosts` 对象；每个主机包含 `platform`（`posix` 或 `win32`）和授权目录 `root`。Windows 远端需启用 OpenSSH Server 并具备 PowerShell；SSH 别名与密钥在私有 SSH 配置中管理，远端无需 Codex。用 config-schema 查看完整规则。
- **SSH**：`WECHAT_SSH_CONFIG` 指定配置文件，默认 `~/.ssh/wechat_hosts_config`。示例见 [SSH 配置模板](config-templates/ssh-config.example)，保持主机密钥校验。
- **HA**：智能体参考 [HA 模板](config-templates/ha.example.json)，通过配置接口写入 `~/.config/wechat-assistant/ha.json`；还需运行 `node src/integrations/cli.mjs enable home-assistant <账号>` 显式启用，当前仅支持只读查询。旧凭据路径继续兼容，新账号不继承启用状态；详见 [集成说明](src/integrations/README.md)。
- **备份（Linux）**：智能体参考 [备份模板](config-templates/backup.example.json)，通过配置接口写入 `~/.config/wechat-assistant/backup.json`；目标、加密公钥及远端私钥独立准备。

运行时可通过 `WECHAT_REMOTE_HOSTS`、`WECHAT_BACKUP_CONFIG` 指向外部配置；配置管理接口不接管自定义路径，遇到不一致时返回 `CONFIG_CUSTOM_PATH_UNMANAGED`。远程工作区可用 `WECHAT_REMOTE_WORKSPACE` 指定。

项目定位由智能体结合请求和实际目录处理，主机注册与允许根目录限定项目选择和文件 API；命令执行权限由远端 SSH 账号控制。远程连接入口见 [远程连接文档](src/infrastructure/remote/README.md)，无需向私有工作区复制执行脚本。

## 升级与验证

已有部署先核实源码、工作区和服务实际路径，再安排更新；保留账号数据、AGENTS.md、远程会话记录和 outputs，不直接覆盖运行目录。服务入口位于 src/，由安装器按真实路径生成。Windows 已有任务配置不一致时明确拒绝覆盖，需要单独核对迁移。

远程验收脚本需要指定主机和专用测试项目，会执行真实任务；登录、发送消息和服务重启按用户授权进行。检查通过与真实收发验收分别报告，见 [贡献指南](CONTRIBUTING.md)。

## 私有数据与发布检查

SSH 私钥、HA 令牌、微信/Codex 凭据、聊天记录、附件、状态数据库和本地配置不进入源码或发布包。模板仅含脱敏示例，不自动启用集成，也不提供维护者的账号权限。

提交前暂存拟发布内容，再运行 `npm run check:release`。它检查暂存区路径和常见密钥格式，不替代人工检查、依赖审查或 Git 历史审计。不要直接压缩整个运行目录；公开发布前独立审计历史，发现凭据泄露时先撤销或轮换。


## 已有安装与升级

安装与升级入口先核验选定的源码目录。目录不存在而已有后台服务时拒绝创建平行安装；可用 `WEIXIN_LINK_DIR` 指定原目录。自定义服务由升级器拒绝接管。服务运行状态不等于微信登录状态；恢复登录时重新运行安装命令并选择“重新登录微信”。

Linux/macOS 首次安装和标准升级使用同一入口：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows PowerShell 首次安装和标准升级使用同一入口：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

`WEIXIN_LINK_DIR` 指向已安装源码目录，`WEIXIN_LINK_REF` 可选择目标分支、标签或提交（默认最新正式 Release）。升级不会运行安装向导或重新登录。先在旁边的暂存目录安装依赖，再通过控制接口确认所有已注册账号空闲，停止原先运行的服务，备份源码和运行数据，切换源码，恢复原先运行的服务并检查启动状态。原本已登录的账号需恢复就绪；原本未登录的账号可稳定进入等待登录状态，不要求升级时完成微信登录。原先停止的账号保持停止。服务定义和覆盖配置、工作目录、Node 工具目录保持原样。

标准安装默认选择 GitHub 最新正式 Release，版本标签为 `vX.Y.Z`，必须与 `package.json` 版本一致。服务每小时检查正式版本，仅在版本号更高时提示；旧 main 安装可迁移。微信安排升级时同时保存版本号和对应提交，等待期间不会改变目标；提交仅用于校验，不作为用户版本号。没有正式发布时不回退 main。自定义分支保持手动维护；开发者可显式设置 `WEIXIN_LINK_REF=main` 安装开发版。旧版无版本号的待执行升级请求会失败并要求重新安排，避免继续跟随提交。

切换或就绪检查失败时，自动恢复旧源码与运行数据后启动旧版。备份保存在源码目录旁的 `.backup-*` 和 `~/.local/share/weixin-link/upgrades/`，其中运行数据可能含凭据，应按私密备份保存。回滚未能确认成功时保留升级锁和 `upgrade.json` 恢复记录，不继续尝试覆盖。突然断电或强制终止进程不会执行自动回滚，应由维护者依据记录恢复；不要直接删除锁重新升级。

自动升级仅适用于安装器管理、服务实际指向所选源码目录、支持维护控制接口的标准安装。Git 工作区、自定义 `.env`、运行数据位于源码目录内、未托管服务、服务覆盖配置指向另一个版本目录等情况会在切换前退出。自定义部署应使用自身发布流程升级，或先制定迁移方案；此入口不会擅自更改其模型提供方配置、启动参数或版本选择。Windows 平台流程需要在 Windows 上验证，其他平台的测试不能替代真实 Windows 服务验收。

## 配置写入锁恢复

配置写入使用带心跳的 `.write-lock`：每 10 秒续期，30 秒未续期后可由下一次写入回收。进程异常退出留下的锁不会永久阻止配置修改；仍有效的锁返回 `CONFIG_BUSY`，不抢占活跃写入。恢复操作同样遵守此锁与原配置摘要检查。升级时避免新旧版本配置写入程序同时运行；不要手动删除活跃锁。
