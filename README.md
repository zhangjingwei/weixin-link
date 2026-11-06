<div align="center">

# Weixin Link

[简体中文](README.md) | [English](README.en.md)

**离座不中断，微信继续干。**

发起任务 · 补充要求 · 查看进展 · 接收文件

[快速开始](#快速开始) · [日常使用](#日常使用) · [配置说明](CONFIGURATION.md) · [使用指南](USER-GUIDE.md) · [参与贡献](CONTRIBUTING.md)

![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

Weixin Link 是一个可自部署的 AI Agent 桥接器，让你通过微信续接电脑或服务器上的 Codex 会话与任务。用文字、图片或文件提出需求，在离开工位后继续补充要求、查看进展并接收结果。

电脑需要保持在线。当前启用 **Codex** 底座；Claude、OpenCode 目录仅作预留，尚未接入。

> **预览阶段**：尚无稳定版本兼容承诺。macOS / Windows 已有适配，完整真机扫码、收发与停止验收尚未完成。安装与运行要求见下文；配置及发布检查见 [配置说明](CONFIGURATION.md)。

## 核心特性

- **会话持久化（Persistent Sessions）**：保存会话关联与任务状态，通过微信继续已连接的 Codex 会话，查询历史和执行进展；也可连接已配置远程主机上的会话。
- **远程任务执行（Remote Execution）**：通过微信发起任务，由智能体在配置的本机或服务器工作区中运行代码、调用工具和执行终端命令。执行范围受授权、主机配置与项目边界约束。
- **文件双向交付（File Delivery）**：从手机发送图片、文档等材料供智能体处理，也可接收生成的代码、日志、图表和其他文件；执行中可继续补充要求与材料。
- **自主部署（Self-Hosted）**：接入服务运行在自己的电脑或私有服务器上，会话、附件和凭据保存在私有运行目录，便于管理访问权限与数据。模型请求和微信通信仍经过所使用的外部服务。

同时支持任务状态查询、停止与恢复，以及多个微信账号的独立管理。

## 可以用来做什么

以下是请求示例；实际执行取决于工作区、工具权限和服务访问条件：

```text
检查这个项目的测试失败原因，修复后说明改了什么。

[附上 PDF]
提取这份材料的关键日期、金额和待办事项。

把刚才的结果整理成 CSV 文件发给我。

补充 先保留原接口，增加一个兼容实现。
```

## 快速开始

### 1. 准备环境

需要可联网的电脑、用于扫码的微信，以及可用的 Codex 账号和模型访问权限。首次安装在电脑终端完成，扫码后可通过微信继续配置。

| 平台 | 架构 | 后台方式 | 当前状态 |
| --- | --- | --- | --- |
| Linux | arm64 / x64 | 用户级 systemd | 现有部署路径 |
| macOS | Apple Silicon / Intel | launchd 用户服务 | 已适配，待完整真机验收 |
| Windows | x64 | 当前用户任务计划程序 | 已适配，待完整真机验收 |

运行时需要 **Node.js 24+ 和 npm**。安装器会在版本不满足时尝试安装经官方校验和验证的私有 Node.js，不覆盖系统版本。

Linux 需要可用的用户级 systemd 会话及 `flock`；Linux/macOS 下载 Node 时需要 `curl`、`tar` 和 SHA-256 校验工具。Mac 需要已登录的图形会话；Windows 需允许运行本地 PowerShell 脚本，安装器不修改执行策略。Windows ARM64 暂不支持。

### 2. 安装并扫码

仓库已公开。首次安装可直接运行以下命令，自动下载 `main` 源码并启动对应平台的安装器，无需预先克隆仓库。

**Linux / macOS**

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/bootstrap.sh)"
```

**Windows x64（PowerShell）**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/bootstrap.ps1')))
```

Windows 引导脚本仅为安装子进程使用 `ExecutionPolicy Bypass`，不修改系统或用户的持久执行策略。

两个引导脚本默认把源码保存到 `~/.local/share/weixin-link/source`（Windows 为用户目录下的 `.local\share\weixin-link\source`），再调用 `install.sh` 或 `install.ps1`。可通过环境变量 `WEIXIN_LINK_DIR` 指定源码目录、`WEIXIN_LINK_REF` 指定分支、标签或提交。再次执行时先检查已注册服务，已有部署会跳过重复安装；未注册服务的既有源码、以及未运行的标准 Linux 安装可继续配对。不会覆盖已有服务配置。无法识别的已有目录会被拒绝。升级请使用[独立升级入口](CONFIGURATION.md#已有安装与独立升级)，这些安装命令不会更新已有部署的代码。源码、工作区和账号数据分别保存。

旧版 `ZERO_LINK_DIR`、`ZERO_LINK_REF` 仍兼容，新变量优先。改名不迁移现有工作区、账号数据或服务；旧源码目录若已存在，先核实原安装再更新。

<details>
<summary>手动克隆安装</summary>

```sh
git clone --branch main https://github.com/zhangjingwei/weixin-link.git
cd weixin-link
```

Linux / macOS：

```sh
./install.sh
```

Windows PowerShell：

```powershell
.\install.ps1
```

</details>

安装器准备私有目录、工作区、依赖及后台服务，启动配对并输出二维码。使用微信扫码确认；扫码者成为该账号档案的初始授权用户。

二维码过期且账号尚未在线时，在安装目录运行下方刷新命令（使用已有安装的 Node.js）：

```sh
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/wechat/account-manager.mjs refresh-qr default
./wechat-setup qr
```

需要显示当前仍有效的二维码时，在安装目录运行 `./wechat-setup qr`（Linux/macOS）。使用引导脚本安装的用户先进入 `~/.local/share/weixin-link/source`，自定义目录则进入对应位置。二维码过期后的刷新方法见 [安装维护说明](CONFIGURATION.md#二维码维护)。

### 3. 在微信完成 Codex 设置

发送 **安装向导**，按当前页面回复 `1`、`2`、`3`。首次可选本机环境；`3` 退出，已完成步骤保留。设备授权只在官方 OpenAI 页面完成，不需要将令牌复制到聊天中。

向导会检查安装、登录及官方协议，并提供一次真实模型测试选项。**扫码成功只说明微信通道在线；真实模型测试成功，才说明本次推理可用。**

随后发送一个普通请求，开始使用。需要帮助时，发送 `使用说明`；安装出现问题时，发送 `安装状态`。

## 日常使用

每条微信消息独立处理，同一条里的文字和附件一起提交。直接发送即可；单独附件也会提交查看。引用消息缺少原文时会明确说明，不自动读取历史引用附件。

| 操作 | 命令 |
| --- | --- |
| 查看任务、队列和发送状态 | `状态` |
| 向当前活动任务追加要求 | `补充 内容` |
| 停止当前任务并清空队列 | `停止` |
| 取回最近结果，不重新执行 | `结果` |
| 核对已提交但未确认的任务 | `恢复` |
| 新建对话 | `新建 名称` |
| 停止并断开，保留历史 | `退出` |
| 查看帮助 | `帮助` |

会话管理使用 `列表`、`新建 名称`、`切换2`、`命名 名称`、`历史`、`搜索 关键词`。`归档2` 保留历史，`还原2` 恢复归档；**`删除2` 永久删除该会话及派生子会话，不可还原。** 编号以实际列表为准。

`模型` 查询官方模型目录；`记忆` 查询原生记忆状态，`开启记忆`、`关闭记忆` 控制当前会话记忆模式。新建或重连默认开启，记忆按 Codex 数据目录隔离，不保证记住每条信息。完整说明见 [使用指南](USER-GUIDE.md)。

## 工作方式

```text
微信私聊
   ↕ 消息与附件
Weixin Link：授权校验 · 持久队列 · 会话管理 · 结果交付
   ↕ 官方协议
Codex app-server
   ↕ 工具与工作区
本机项目 / 已配置远程主机 / 可选独立容器
```

接入层管理消息和任务生命周期，推理与工具循环由官方 Codex 完成。项目定位由智能体结合用户请求与环境核实，不通过接入层项目别名表自动执行。

收件、执行与发送分别记录状态。重启后恢复未提交消息，已提交但结果未知时查询原轮次，不盲目重提。停止只处理当前对话拥有的任务及远程命令，不全局停止共享服务。接口接受不代表用户已读、已播放或客户端已展示。

## 配置与扩展

直接在微信说明“帮我配置远程主机”或“检查家庭设备连接”，由智能体查看现状、补齐必要信息，再调用配置命令处理。无需手动填写运行 JSON 或记忆英文命令；这条路径需要模型可用。

配置示例在 [`config-templates/`](config-templates/)，实际凭据、会话和附件保存在私有目录。工作区路径由私有 `installation.json` 管理；个性化规则写在工作区 `AGENTS.md`，程序只更新明确标记的管理区块。

- **多账号**：独立扫码和授权，不复制主账号凭据，也不换绑旧档案来继承会话。
- **远程 Codex**：由智能体检查 SSH、主机参数及允许根目录，连接远程项目，见 [远程连接](src/remote/README.md)。
- **容器（Linux）**：需自行准备 rootless Podman、Quadlet 和 cgroup v2 内存控制，容器独立登录，不复制宿主 Codex 凭据。
- **Home Assistant**：配置后仅支持只读查询。
- **加密备份（Linux）**：独立配置目标与密钥，不默认连接任何 NAS。

例如，直接在微信发送：

```text
帮我添加一台远程主机，先检查连接。
检查家庭设备连接是否正常。
帮我创建第二个机器人账号，并把二维码发给我。
查看机器人账号状态。
```

智能体查询现状、补齐必要信息，再调用配置或账号管理接口。用户按提示完成扫码和登录授权；无需通过 IDE 或文本编辑器手工修改服务器配置。

## 附件与结果

| 输入 | 处理方式 |
| --- | --- |
| 图片 | 识别图片内容 |
| PDF | 提取文字并读取页图 |
| DOCX、PPTX、XLSX | 提取文档、幻灯片和表格文字 |
| 视频 | 抽取画面进行分析 |
| 语音 | 使用微信提供的转写文字 |

结果可直接回复文字，也可交付图片、H.264 MP4、PDF、ZIP、TXT、Markdown、CSV、JSON、Word、Excel 和 PowerPoint 文件。MP3、WAV、SILK 以音频文件交付。

接收单消息最多 10 个附件、合计 50MiB；交付每组最多 8 个、总量最多 50MiB。具体解析范围与格式要求见 [使用指南](USER-GUIDE.md)。

## 常见问题

**微信在线，但不回答？** 先发送 `安装状态`，按提示安装、登录或验收 Codex。

**任务或发送结果不确定？** 先查 `状态`，需要时用 `恢复` 对账，不重复提交同一任务。保存的结果用 `结果` 取回，重发可能包含之前已接受的附件。

**容器未就绪？** 查看 `安装状态`，按需使用 `启动容器`、`登录智能体`；缺少系统条件时先处理具体报错。

**微信诊断入口：** 发送“运行诊断”“服务状态”“查看最近错误”“导出诊断报告”，不依赖模型，仅读取当前账号日志和服务状态；报告以脱敏 JSON 文件交付。

## 安全与扫码

- 从本仓库 `main` 获取安装脚本和源码。
- 使用自己的微信扫码确认，确认者成为该账号档案的初始授权用户；不要分享登录二维码或设备验证码。
- Codex 登录在官方 OpenAI 授权页面完成，配置和凭据保存在部署者的私有运行目录。
- 二维码本地展示窗口为 90 秒；已在线账号不重新配对。安全问题的报告方式见 [安全政策](SECURITY.md)。

## 文档与许可

[使用指南](USER-GUIDE.md) · [配置与发布边界](CONFIGURATION.md) · [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

本项目自有代码与文档采用 [MIT License](LICENSE)。第三方依赖、可选二进制和外部服务分别遵循其条款。Weixin Link 为独立项目，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。
