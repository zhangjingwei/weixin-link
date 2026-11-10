<div align="center">

# Weixin Link

**你的专属 AI 助手，随时在微信里。**

查资料、想方案、出结果。

[简体中文](README.md) | [English](README.en.md)

[快速开始](#快速开始) · [使用场景](#使用场景) · [常用命令](#常用命令) · [安装与升级](#安装与升级)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

**安全隐私：** 装在你自己的电脑上，账号和密钥握在自己手里。

**个人助理：** 专属AI，拥有记忆，越用越顺手

**更好用的智能：** 模型你来选，智能体来干活：会规划、会用工具，复杂的事也能从头做到尾。

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

**运行安装命令 → 在终端向导选择并验证模型 → 微信扫码 → 收到连接结果。** 需要自己的微信账号，以及 Codex 订阅或受支持的模型服务；Node.js 24+ 由安装器按需准备。

**Linux / macOS**：在电脑终端执行：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

**Windows x64**：在 PowerShell 执行：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

安装器会先在终端提示选择订阅登录、DeepSeek、Qwen 或 Kimi，完成模型测试后显示微信二维码。扫码成功后，助手会推送安装结果。第三方密钥只在电脑终端输入，不要发到微信。

**模型访问说明：** 选择 [Codex 订阅登录](https://learn.chatgpt.com/docs/auth)，需要你自己的账号，并确保安装设备能正常访问 OpenAI 服务。DeepSeek、Qwen、Kimi 使用各自平台的密钥接入，不需要 Codex 订阅，也不受 OpenAI 订阅登录的访问限制。能否正常使用，以安装向导的模型测试为准。

模型向导会根据终端语言环境自动使用中文或英文；需要指定时，在源码目录运行 `node src/setup/setup.mjs wizard --lang zh` 或 `node src/setup/setup.mjs wizard --lang en`。

> 扫码成功只确认微信已连接。终端显示模型测试通过后，才能确认助手可以处理任务。安装遇到问题时，发送 **安装状态**。

<details>
<summary>平台支持与安装要求</summary>

| 平台 | 支持架构 | 要求与验证状态 |
| --- | --- | --- |
| Linux | arm64 / x64 | 已有部署验证 |
| macOS | Apple Silicon / Intel | 已登录的图形会话；已验证扫码和文字收发，完整验收仍在进行 |
| Windows | x64 | 需允许运行 PowerShell 脚本；待完整真机验收 |

Linux/macOS 需要 curl、tar。Windows ARM64 暂不支持。

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
- **执行过程可掌握**：在微信查看进度、补充要求或停止任务。

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

升级时，重新执行[快速开始](#快速开始)中的安装命令。标准安装也会在发现正式更新时提示，确认后才升级。自定义部署与恢复步骤见[配置与维护](CONFIGURATION.md#已有安装与升级)。

## 登录二维码

以下示例适用于 Linux/macOS，从已安装的源码目录运行。Windows 使用相同的 `setup.mjs wechat-login` 命令；私有 Node 的完整路径见[二维码维护](CONFIGURATION.md#二维码维护)。

### 首次登录

已经安装但尚未扫码时，可单独运行：

```sh
cd ~/.local/share/weixin-link/source
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/setup/setup.mjs wechat-login --human
```

### 升级后再次登录

再次执行安装命令会检查并升级已有部署；源码已是目标版本时不会重启，也不会重复运行模型向导或要求扫码。如果微信绑定仍有效，无需运行二维码命令。若已解绑，或账号服务仍在运行但尚未就绪，明确选择重新登录：

```sh
cd ~/.local/share/weixin-link/source
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/setup/setup.mjs wechat-login --relogin --human
```

### 登录不同账号

每个微信账号使用单独的账号档案。先在安装源码目录创建新档案，再获取它的二维码；已创建过的档案可跳过创建命令：

```sh
cd ~/.local/share/weixin-link/source
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/setup/account-manager.mjs create bot2
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/setup/setup.mjs wechat-login bot2 --human
```

如果 `bot2` 的服务仍在运行且需要重新授权，使用 `node src/setup/setup.mjs wechat-login --relogin bot2 --human`。扫码后命令会等待登录结果；若手机要求 PIN，同一个终端会提示输入。自定义安装目录和其他维护方式见[二维码维护](CONFIGURATION.md#二维码维护)。

登录服务返回 HTTPS 地址时，命令会在本机图形桌面尝试打开浏览器，并在终端显示地址；仍会保留二维码 PNG。Windows 首次安装也会尝试打开该地址。SSH 会话只显示地址和二维码，不会在远端弹浏览器。地址可能过期，请勿分享。

## 更多能力与文档

- [使用指南](USER-GUIDE.md)：会话、模型、记忆、附件与结果。
- [配置与维护](CONFIGURATION.md)：安装、升级、备份和故障处理。
- [远程连接](src/infrastructure/remote/README.md)：连接已授权的远程工作区。
- [可选集成](src/integrations/README.md)：HA 只读查询、SSH 远端操作和 RSSHub 新闻源，按账号显式启用；备份统一接入仍待迁移。
- [配置示例](config-templates/)：部署配置参考。
- [参与贡献](CONTRIBUTING.md)：问题反馈与代码贡献。

## 安全与许可

使用自己的微信扫码，不要分享登录二维码或设备验证码。选择订阅登录时，请在官方 OpenAI 页面授权。只授权助手访问你允许的工作区和服务。安全问题请参阅 [安全政策](SECURITY.md)。

本项目采用 [MIT License](LICENSE)。第三方依赖与外部服务遵循各自条款，见 [第三方许可](THIRD_PARTY_NOTICES.md)。Weixin Link 是独立项目，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。
