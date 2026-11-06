# Zero Link · 微信 → Codex

通过微信私聊使用自己的 Codex 智能体：发送文字、图片或文件，接收任务进展、结果和生成的附件。微信接入层负责收发、账号隔离、队列与会话管理；模型推理和工具执行由官方 Codex app-server 完成。

项目处于开源准备阶段，尚无稳定版本兼容承诺。**现有 Git 历史仍含个人主机和路径信息，不能直接作为公开仓库发布。** 发布前需审计并清理历史，或建立不携带旧历史的发布仓库；详情见 [配置与发布边界](CONFIGURATION.md)。

## 功能与边界

- 文字、图片、PDF、Office 文档、视频及语音附件接收；解析范围和失败会明确说明。
- 持久会话、历史查询、切换、归档，以及当前任务补充、停止和未知结果对账。
- 同一套源码运行多个独立微信账号，各自保存凭据、授权名单、收件队列和日志。
- 通过显式文件链接交付图片、视频和文档；支持已配置远程主机上的官方 Codex 会话。当前启用 Codex 底座，Claude 和 OpenCode 仅为未启用的预留目录。
- 使用 Codex 原生记忆；可选 Linux rootless Podman 隔离环境、Home Assistant 只读查询等集成。

当前按微信私聊使用，不支持将机器人拉入普通微信群。微信在线不代表模型已安装、登录或获得推理权限；接口接受不代表用户已读、已播放或客户端已展示。项目不提供绕过服务授权或权限限制的能力。

## 系统要求

需要可联网的电脑、可扫码的微信账号，以及可用的 Codex 账号和模型访问权限。

| 平台 | 架构 | 安装入口 | 后台运行方式 |
| --- | --- | --- | --- |
| Linux | arm64 / x64 | `./install.sh` | 用户级 systemd |
| macOS | Apple Silicon / Intel | `./install.sh` | launchd 用户服务，需已登录图形会话 |
| Windows | x64 | `.\install.ps1` | 当前用户任务计划程序 |

macOS、Windows 已有安装与服务适配，**尚未完成真机安装、扫码、收发和停止的完整验收**；静态检查或 Linux 测试通过不代表三平台可用。Windows ARM64 不受支持，未发布 Homebrew 分发包。Mac/Windows 不保证用户注销后继续运行。

运行时需要 Node.js 24 或受支持的更新版本及 npm。安装器在版本不满足时尝试下载固定 Node.js 24.21.0，核对官方 HTTPS 校验和，安装到用户私有目录，不覆盖系统 Node。Linux/macOS 需具备 curl、tar 和 SHA-256 校验工具；Linux 还需 flock 及可用的用户级 systemd 会话。Windows 需允许运行本地 PowerShell 脚本，安装器不修改执行策略、不要求保存 Windows 密码。

## 快速开始

在取得源码并进入项目根目录后执行：

Linux / macOS：

```sh
./install.sh
```

Windows PowerShell：

```powershell
.\install.ps1
```

安装器依次准备私有目录、工作区、依赖、后台服务和独立配对流程，并输出二维码。首次扫码前仍需本地终端；扫码者成为该账号档案的初始授权用户。不要将二维码或登录信息公开分享。

Linux/macOS 如需再次显示当前二维码：

```sh
./wechat-setup qr
```

Windows 或已配置 Node 的终端可使用：

```sh
node setup.mjs qr
```

二维码采用 90 秒保守本地展示窗口，不保证服务端有效期；已过期时运行 `node account-manager.mjs refresh-qr default`。在线账号拒绝刷新，避免误登出。

扫码连接后，在微信发送 **安装向导**，按当前页面回复 1、2、3；3 退出，已完成步骤保留。选择本机环境即可继续安装、登录与检查 Codex。设备授权只在官方 OpenAI 页面完成，已登录账号不会被自动替换。

向导先检查登录与官方协议，再提供一次真实模型测试选项；只有该测试成功才确认本次推理可用，跳过时仍未验证模型。也可使用以下独立命令：

- `安装帮助`、`安装状态`：查看步骤与实际状态。
- `安装Codex`、`登录Codex`、`验收Codex`：执行对应维护操作。
- `使用说明`：查看微信内使用指南。

安装维护命令由代码处理，不要求先接通模型。当前安装目标 Codex 版本为 0.163.0；已有 CLI 不会直接覆盖。协议检查成功不等于模型推理成功。

### 分步安装与诊断

已有 Node.js 24+ 和 npm 时，可拆分执行：

```sh
node setup.mjs init
node setup.mjs deps
node setup.mjs services
node setup.mjs pair
node setup.mjs qr
node setup.mjs doctor
```

`init` 创建私有配置和工作区，缺少 AGENTS.md 时生成简版规则，不复制其他部署的微信凭据、授权名单、SSH 或 HA 配置，也不覆盖已有工作区的 AGENTS.md。`services` 准备后台服务；配对成功后启动对应账号并检查消息通道。遇到权限不足、已有服务冲突或缺少系统依赖时会明确阻断，不自动申请管理员权限。

## 日常使用

直接发送请求，例如“解释这段代码”或在同一条消息中附带文件并说明任务。每条微信消息独立持久化与处理，同条消息内的文字和附件一起提交；不按时间跨消息自动合并，无需发送“开始”或 `/collect`。单独附件也会提交查看，后续说明由智能体结合会话理解。

| 命令 | 行为 |
| --- | --- |
| `/status` | 查看当前任务、队列与发送状态 |
| `补充 内容` | 向当前活动轮次补充文字；接口接受不保证已执行 |
| `/stop` | 中断当前任务、清空排队消息，并核实本对话委托的远程任务 |
| `/exit` | 停止并断开当前连接，保留历史 |
| `/new` 或 `/reset` | 新建对话 |
| `/result` | 查看最近任务结果；不会重新执行任务 |
| `/recover` | 对账已提交但未确认的任务，不重复提交 |
| `/models` | 查询当前官方接口返回的模型目录，不切换模型 |
| `/memory` | 查询 Codex 原生记忆状态 |
| `/memory auto on` / `/memory auto off` | 控制当前会话记忆模式；新建或重连默认开启 |
| `/help` | 查看帮助 |

配置了 DeepSeek 余额查询后可用 `/balance`，该查询不启动模型推理。

会话管理可使用 `列表`、`新建 名称`、`切换2`、`命名 名称`、`历史`、`历史2`、`翻页`、`搜索 关键词`。`归档2` 保留历史，`还原2` 恢复归档；**`删除2` 永久删除指定会话及派生子会话，不可还原。** 会话编号以当前列表为准。

收件和任务执行状态分别保存。重启后恢复未提交消息，已提交或结果未知时先向原官方轮次对账，不盲目重新执行。停止仅处理当前对话拥有的任务，不全局终止其他会话或共享 app-server。详细操作见 [使用说明](USER-GUIDE.md)。

## 附件输入与结果交付

- 图片按实际内容解码并标准化；动图只取首帧。
- PDF 自动提取有限页数的文字和页图，视频使用有限范围抽帧，不代表完整阅读或观看，也不分析视频音轨。
- DOCX、PPTX、XLSX 做有界文字提取，不运行宏、不访问外链；旧 Office、普通 ZIP 和未知格式保留原件，不保证解析。Office 文本解析额外需要 Python 3。
- 语音优先使用微信提供的转写；没有转写时不保证识别音频，不默认上传外部 ASR。
- 原始引用按同账号、同聊天对象查找；缺失原文会说明，不自动下载历史引用附件。

接收单消息最多 10 个附件、总计 50MiB，并受下载时限、存储和剩余空间限制；失败项会单独报告。附件与聊天记录不应放入源码或公开仓库，历史附件需由部署者按需清理。

智能体交付文件时使用本机实际文件的 Markdown 链接，优先放在工作区 `outputs/`，接入层再转换为微信附件。支持图片、H.264 MP4、PDF、ZIP、文本及常见 Office 文档等；每组最多 8 个附件，原文件及发送总量最多 50MB。远程产物需先复制到本机，普通路径文字不会自动上传。

MP3、WAV、SILK 默认按音频文件交付，不承诺原生语音气泡。原生语音和原生工具状态目前未通过微信客户端展示验收，默认关闭，仅保留实验开关；有意义的任务进展沿用普通文字消息。

## 配置与多账号

配置方式、示例路径和发布检查见 [CONFIGURATION.md](CONFIGURATION.md)。源码不预设个人主机、默认地点、微信账号或备份目标。

- 默认账号私有状态位于 `~/.local/share/wechat-ping-bot`；其他账号位于其中的 `accounts/<id>/`。
- 工作区与 Codex 路径由私有 `installation.json` 管理；个性化规则写入部署工作区的 AGENTS.md。项目定位由智能体底座处理，接入层不维护项目别名表或注入目标候选。
- 多账号凭据、授权名单、会话、收件队列、日志和控制接口独立；共享源码不代表共享授权。
- 登录凭据、设备码、令牌、聊天记录、附件、数据库和本地主机配置不得提交到 Git。

在项目根目录管理账号：

```sh
node account-manager.mjs list
node account-manager.mjs create bot2
node account-manager.mjs login bot2
node account-manager.mjs qr bot2
node account-manager.mjs start bot2
node account-manager.mjs stop bot2
```

这些是按需使用的独立命令；`stop` 会等待该账号空闲后停用，不影响其他账号。新账号必须独立扫码，不能复制主账号凭据或将旧档案换绑后继承会话；二维码生成不等于登录成功。账号名需以小写字母开头，仅含小写字母、数字和连字符，最多 32 字符。要求验证码时用 `verify 账号名 数字验证码` 提交，避免公开验证码。

### 可选集成

- **远程 Codex**：在私有工作区配置 `remote-hosts.json` 和严格验证主机密钥的 SSH 配置。统一入口为 `node src/remote/remote-codex.mjs`，无需复制执行脚本到工作区，说明见 [远程连接](src/remote/README.md) 和 [远程任务协调](src/core/remote-tasks/README.md)。主机登记和允许根目录用于限定执行边界，不构成执行授权。
- **Home Assistant**：按示例在私有目录配置 URL 和令牌，当前仅授权只读查询，不开关设备或修改配置。
- **容器隔离（Linux）**：需要 rootless Podman、用户级 systemd/Quadlet 和 cgroup v2 内存控制。向导可选择独立容器；默认上限为 1.5GiB 内存、无交换空间、0.5 核 CPU，不复制宿主 Codex 凭据。容器需独立登录，环境未就绪时明确报错，不自动修改内核或重启。
- **加密备份（Linux）**：需独立配置目标和密钥，不默认连接任何 NAS。当前模块分支已移除内置新闻聚合、专用节点监控和自动主备模型切换，不沿用旧版部署说明。

记忆统一由 Codex 原生机制管理，并按对应 Codex 数据目录隔离。接入层不维护另一套事实库，不保证记住每条消息；共用同一 Codex 数据目录的客户端也处在相同记忆范围内。

## 故障排查

1. 微信在线但不能推理：发送 `安装状态`，按提示安装、登录或验收 Codex；终端可运行 `node setup.mjs doctor`。
2. 二维码过期：运行 `node account-manager.mjs refresh-qr 账号名`，不要使用旧图片。
3. 容器未就绪：查看 `安装状态`，使用 `启动容器`、`登录Codex`；缺少系统条件时先处理明确报错。
4. 任务或发送结果未知：先查 `/status`，需要时用 `/recover` 对账；不要反复提交同一任务。已保存的结果可通过 `/result` 查看，重发可能包含先前已接受的附件。
5. 需要诊断摘要：运行 `node diagnostics.mjs`。日志与诊断材料仍可能涉及运行信息，分享前需检查并脱敏。

Linux 默认账号服务可这样检查：

```sh
systemctl --user status wechat-ping-bot.service
journalctl --user -u wechat-ping-bot.service -f
```

其他账号使用 `wechat-ping-bot@<id>.service`；不要将这些 Linux 命令用于 macOS 或 Windows。服务操作和真实收发应在明确授权的部署环境执行。

## 源码结构

- `src/core/`：任务生命周期、持久队列、恢复和远程任务协调。
- `src/wechat/`：账号、协议、消息收发与机器人组合入口。
- `src/base/`：智能体底座；当前实现位于 `codex/`，其他目录仅预留。
- `src/remote/`：SSH 连接、隧道和有界重连。
- `src/media/`：附件准备、文档与音视频处理、结果交付。
- `src/setup/`：安装向导、平台服务、诊断和后端选择。
- `src/integrations/`：HA、备份等可选集成。
- `src/tools/` 与 `tests/`：维护工具及按模块组织的测试。

根目录 `bot.mjs`、`setup.mjs` 等保留兼容命令入口。部署必须包含完整 `src/` 和依赖，不能仅复制根目录脚本。协议说明见 [底座文档](src/base/README.md)。

## 开发与验证

在隔离开发目录使用 Node.js 24+，不要用生产账号目录执行测试：

```sh
npm ci
npm run check:release
node --test tests/tools/release-check.test.mjs
node --test tests/setup/platform-service.test.mjs tests/setup/platform-smoke.test.mjs
npm test
```

`npm ci` 的 postinstall 会重放固定 SDK 版本的适配补丁。远程适配器变更还需运行 `node --test tests/remote/*.test.mjs`；真实微信收发、远程任务和媒体检查需要专用环境，不能把模拟测试当作上线验收。

`.github/workflows/platform.yml` 配置三系统核心检查，但配置工作流不代表 CI 已通过。测试失败需逐项报告，不能忽略失败后宣称全部通过。更多要求见 [贡献指南](CONTRIBUTING.md)。

发布检查读取暂存区的 Git 内容，不能替代人工审计或历史清理。不要直接打包整个运行目录，其中可能含私有配置和备份。

## 文档与许可证

- [使用说明](USER-GUIDE.md)：微信内安装、会话和故障处理。
- [配置与发布边界](CONFIGURATION.md)：私有配置、可选集成与发布前检查。
- [贡献指南](CONTRIBUTING.md)：开发验证和提交要求。
- [安全报告](SECURITY.md)：漏洞报告和敏感信息处理。
- [第三方许可说明](THIRD_PARTY_NOTICES.md)：依赖与可选二进制许可。

本项目自有代码与文档采用 [MIT License](LICENSE)。第三方依赖、可选二进制及外部服务分别遵循其原有条款。本项目是独立实现，不代表微信、OpenAI 或其他服务提供方的官方产品或背书；使用外部服务需自行取得账号与访问授权。
