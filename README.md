<div align="center">

# Weixin Link

**离开电脑，也能用微信让智能体继续干活。**

发任务 · 补充要求 · 查看进度 · 接收文件

[简体中文](README.md) | [English](README.en.md)

[快速开始](#快速开始) · [使用场景](#使用场景) · [常用命令](#常用命令) · [安装与升级](#安装与升级)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

Weixin Link 把微信私聊接到你电脑或服务器上的 **Codex**。电脑或服务器保持在线时，你可以从微信发起任务、补充要求，并接收回答和文件。

<table align="center">
  <tr><th align="center">追问城市 · 查询天气</th><th align="center">语音转写 · 生成故事</th></tr>
  <tr>
    <td align="center" valign="top"><img src="docs/images/weather-conversation.png" width="320" alt="微信对话：追问城市后查询天气"></td>
    <td align="center" valign="top"><img src="docs/images/voice-story-conversation.png" width="320" alt="微信对话：语音转写后生成短篇故事"></td>
  </tr>
  <tr><th align="center">核对可用设备</th><th align="center">查询设备读数</th></tr>
  <tr>
    <td align="center" valign="top"><img src="docs/images/available-devices-conversation.png" width="400" alt="微信对话示意：核对已授权的 SSH 和 Home Assistant 设备"></td>
    <td align="center" valign="top"><img src="docs/images/temperature-conversation.png" width="400" alt="微信对话示意：查询温度并说明设备读数差异"></td>
  </tr>
</table>

<p align="center"><sub>对话示意图根据实际交流整理；设备名称、数量和读数已替换。可用能力取决于当前授权。</sub></p>

## 快速开始

**运行安装命令 → 微信扫码 → 收到助手主动推送的安装向导 → 按数字继续。** 如果微信暂未显示向导，仍可发送「安装向导」恢复。需要自己的微信账号，以及所选智能体底座的模型访问权限；Node.js 24+ 由安装器按需准备。

**Linux / macOS**：在电脑终端执行：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

**Windows x64**：在 PowerShell 执行：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

用微信扫描安装器提供的二维码并确认，等待助手主动推送安装向导。项目依赖已包含固定版本的官方 Codex CLI；按提示完成登录和模型测试后，直接发一句任务需求即可。

> 扫码成功只确认微信通道。Codex 向导的模型测试通过后，才能确认 Codex 可处理请求。安装遇到问题时，发送 **安装状态**。

<details>
<summary>平台支持与安装要求</summary>

| 平台 | 支持架构 | 要求与验证状态 |
| --- | --- | --- |
| Linux | arm64 / x64 | 用户级 systemd 会话及 flock；已有部署验证 |
| macOS | Apple Silicon / Intel | 已登录的图形会话；已验证扫码和文字收发，完整验收仍在进行 |
| Windows | x64 | 当前用户计划任务、允许运行 PowerShell 脚本；待完整真机验收 |

Linux/macOS 需要 curl、tar；安装私有 Node.js 时还需要 SHA-256 校验工具。安装器验证官方校验和，不覆盖系统 Node.js。Windows ARM64 暂不支持，安装器不修改持久执行策略。

已发布正式版 [v1.3.3](https://github.com/zhangjingwei/weixin-link/releases/tag/v1.3.3)，尚无长期版本兼容承诺。更多要求与维护步骤见 [配置说明](CONFIGURATION.md)。

</details>

## 使用场景

以下是请求示例，实际执行依赖你配置的工作区、工具和服务权限。

| 你想做什么 | 在微信里怎么说 |
| --- | --- |
| **离开电脑后继续处理代码** | “检查这个项目的测试失败原因，修复后告诉我改了什么。” |
| **随时补充任务要求** | “补充 先保留原接口，再增加兼容实现。” |
| **把手机上的材料交给智能体** | 发一份 PDF，再说：“提取关键日期、金额和待办事项。” |
| **直接拿到可用的文件** | “把刚才的结果整理成 CSV 文件发给我。” |

- **继续同一个任务**：保留会话与任务状态，支持多个对话之间切换。
- **文字之外也能传材料**：接收图片、PDF、Office 文档等附件，交付文本、图片和生成的文件。
- **执行过程可掌握**：智能体的阶段进展形成完整语句时即发送到微信；也可查询状态、补充要求、停止任务或核对未确认的结果。最终回答仍在完成后发送。
- **部署在自己的环境**：接入服务、会话和凭据由你管理；模型请求与微信通信仍经过相应外部服务。

## 常用命令

普通任务直接发送即可。使用“新建”等命令时，按提示回复下一条消息；等待输入时可发“取消”。

| 命令 | 用途 |
| --- | --- |
| `日常` | 返回固定日常会话 |
| `状态` | 查看当前任务与队列 |
| `进度` | 查看正在处理到哪一步 |
| `补充` | 向正在执行的任务追加要求 |
| `停止` | 停止当前任务 |
| `结果` | 查看最近一次结果 |
| `新建` | 新建项目 |
| `列表` | 查看项目列表 |
| `计划` | 先让助手制定计划 |
| `代码审查` | 审查当前项目的修改 |
| `使用说明` | 查看完整用法和更多命令 |

需要审查指定分支或提交、恢复会话、管理附件或排查问题时，见[使用指南](USER-GUIDE.md)。

## 安装与升级

升级时，重新执行[快速开始](#快速开始)中对应平台的安装命令。微信内确认升级仅适用于安装器管理的标准部署；自定义部署、扫码刷新和恢复步骤见 [配置与维护](CONFIGURATION.md#已有安装与升级)。

标准安装每小时检查 GitHub 正式 Release（`vX.Y.Z`），按版本号提示升级，不跟随主干提交、不自动降级，也不选择预发布版。只有明确同意才会升级；执行时固定该版本对应的提交用于完整性校验。没有正式 Release 时不会回退到主干。投递结果不明的提醒不自动重发。

## 登录二维码

以下命令适用于 Linux/macOS。Windows 首次登录由安装器提供二维码。

### 首次登录

运行[安装命令](#快速开始)，安装器会准备服务并显示默认账号的二维码。已经安装、但尚未扫码时，可单独运行：

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

### 升级后再次登录

升级不会要求重新扫码；如果微信绑定仍有效，无需运行二维码命令。若已解绑，或账号服务仍在运行但尚未就绪，明确选择重新登录：

```sh
WEIXIN_LINK_RELOGIN=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

### 登录不同账号

每个微信账号使用单独的账号档案。先在安装源码目录创建新档案，再获取它的二维码；已创建过的档案可跳过创建命令：

```sh
cd ~/.local/share/weixin-link/source
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/setup/account-manager.mjs create bot2
./qr.sh bot2
```

如果 `bot2` 的服务仍在运行且需要重新授权，使用 `./qr.sh --relogin bot2`。扫码后命令会等待登录结果；若手机要求 PIN，同一个终端会提示输入，无需再运行验证命令。二维码有断缝时，可设置 `WEIXIN_LINK_QR_STYLE=full`。自定义安装目录和其他维护方式见[二维码维护](CONFIGURATION.md#二维码维护)。

## 更多能力与文档

当前使用 **Codex** 处理任务。远程主机也使用 Codex 路径。

- [使用指南](USER-GUIDE.md)：会话、模型、记忆、附件与结果。
- [配置与维护](CONFIGURATION.md)：安装、升级、备份和故障处理。
- [远程连接](src/infrastructure/remote/README.md)：连接已授权的远程工作区。
- [可选集成](src/integrations/README.md)：HA 只读查询、SSH 远端操作和 RSSHub 新闻源，按账号显式启用；备份统一接入仍待迁移。
- [消息架构](docs/architecture/README.md)：微信入口、任务执行、智能体底座与投递的模块边界。
- [微信 SDK](https://www.npmjs.com/package/wechatbot-zerolink)：固定版本与包校验值见 `package-lock.json`。
- [配置示例](config-templates/)：部署配置参考。
- [参与贡献](CONTRIBUTING.md)：问题反馈与代码贡献。

## 安全与许可

使用自己的微信扫码，不要分享登录二维码或设备验证码。Codex 登录在官方 OpenAI 授权页面完成。只授权智能体访问你允许的工作区和服务。安全问题请参阅 [安全政策](SECURITY.md)。

本项目采用 [MIT License](LICENSE)。第三方依赖与外部服务遵循各自条款，见 [第三方许可](THIRD_PARTY_NOTICES.md)。Weixin Link 是独立项目，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。
