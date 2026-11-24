<div align="center">

# Weixin Link

**你的专属 AI 助手，随时在微信里。**

查资料、想方案、出结果。

[简体中文](README.md) | [English](README.en.md)

[快速开始](#快速开始) · [使用场景](#使用场景) · [自然语言使用](#自然语言使用)

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

安装时用方向键选择，回车确认。

### 首次安装

Linux / macOS：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows x64（PowerShell）：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

按提示选择模型、登录微信。中国大陆如果无法访问 OpenAI，使用 [Codex 订阅](https://learn.chatgpt.com/docs/auth) 需自行解决访问问题；DeepSeek、Qwen、Kimi 不受此限制。

### 升级

可以直接说“看看有没有新版本”，核对后说“升级到刚才查到的版本”；升级会在空闲后备份、切换并检查健康状态。也可说“这个版本先不升级”，仅跳过该版本。模型不可用时，精确的“检查更新”“升级”“重启”等入口仍保留。

运行命令，在菜单中选择“升级”：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows x64（PowerShell）：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

### 重新登录微信

运行命令，在菜单中选择“重新登录微信”：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows x64（PowerShell）：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

### 卸载

运行命令，在菜单中选择“卸载”，按提示确认：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows x64（PowerShell）：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

卸载会保留账号数据和工作区。

支持 Linux（x64、arm64）、macOS（Intel、Apple Silicon）和 Windows（x64）。

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

## 自然语言使用

留在一个微信入口，直接说需求即可：

- “知识库项目做到哪一步了？”
- “让工具箱优化搜索页面，保持现有接口。”
- “给知识库当前任务补充：需要支持 PDF。”
- “停止工具箱当前任务”“查一下上次的结果”。
- “看看有没有新版本”“升级到刚才查到的版本”“重启当前账号”。

助手会核对目标再调用工具；查询不创建任务，已排队或已安排不等于完成。进度和结果带项目标识返回，不需要来回切换。跨项目提交仅支持文字，附件不隐式转交。

模型不可用时，仍可发送“停止”“状态”“安装帮助”等应急命令。完整人工操作见[精确命令参考](docs/reference/commands.md)，日常流程见[使用指南](USER-GUIDE.md)。

## 常见问题

### Codex 订阅登录提示未开启 Device code authorization

安装器使用设备码登录。先在 ChatGPT 的「设置 → 安全」中开启 **Device code authorization**（设备码授权／设备码登录，名称可能随界面变化），再按安装终端显示的官方链接和设备码完成授权。受管理的工作区需由管理员在工作区权限中允许设备码登录。

如果刚才已被拒绝或设备码已过期，开启后重新运行安装命令，选择「配置模型 → 订阅登录」，使用本次新显示的设备码。此设置只与 Codex 订阅的设备码登录有关；第三方模型的 API Key 配置不需要它。其他登录失败仍需按实际错误检查网络或账号权限。

参见 [OpenAI 官方设备码登录说明](https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta)。

### 已完成订阅授权，但模型测试超时

登录授权、Codex 原生接口检查和真实模型测试是不同阶段。模型测试最多等待约 3 分钟，在独立临时目录执行，不读取项目工作目录的规则。出现 `MODEL_PROBE_TIMEOUT` 表示本次推理未验证，不等于订阅登录失败；可在当前安装向导选择「仅重试模型测试」，保留已有授权，无需再次进行设备码登录。也可选择稍后配置；只有本轮随机校验码完全匹配才记录为通过。

## 更多能力与文档

可留在同一个微信入口说“让工具箱优化搜索页面”：明确的跨项目文字任务进入对应项目的持久队列，进度与结果带项目标识直接返回，无需手动切换。查询不会创建任务，附件不隐式转交。

- [使用指南](USER-GUIDE.md)：会话、模型、记忆、附件与结果。
- [配置与维护](CONFIGURATION.md)：安装、升级、备份和故障处理。
- [远程连接](src/infrastructure/remote/README.md)：连接已授权的远程工作区。
- [可选集成](src/integrations/README.md)：HA 只读查询、SSH 远端操作和 RSSHub 新闻源，按账号显式启用；备份统一接入仍待迁移。
- [配置示例](config-templates/)：部署配置参考。
- [参与贡献](CONTRIBUTING.md)：问题反馈与代码贡献。

文件交付的存放位置、失败状态、原件清理和 7 天重发保留期见[文件交付与临时文件生命周期](docs/artifact-delivery.md)。

## 安全与许可

使用自己的微信账号确认登录，不要分享登录地址或设备验证码。选择订阅登录时，请在官方 OpenAI 页面授权。只授权助手访问你允许的工作区和服务。安全问题请参阅 [安全政策](SECURITY.md)。

本项目采用 [MIT License](LICENSE)。第三方依赖与外部服务遵循各自条款，见 [第三方许可](THIRD_PARTY_NOTICES.md)。Weixin Link 是独立项目，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。

### 自然语言管理项目与任务

可直接说“知识库做到哪了”“切换到知识库”“给知识库当前任务补充……”或“停止知识库当前任务”。配套 MCP + Skill 只访问当前用户已登记的项目；同名或不明确时先询问。查询进展不会切换项目，切换与停止以系统确认结果为准，原有命令仍可使用。语音有可靠转写时也可按原意处理。

安装、禁用、卸载、工具边界和验证见 [自然语言管理说明](docs/features/management-mcp.md)。

支持的自然语言管理还包括：新建/命名项目、搜索历史、只读查看结果、明确重发原附件、核对指定未确认任务、创建/查看/取消计划，以及检查和跳过指定更新版本。新建默认不切换；结果查询不重发；取消计划不停止已提交任务。细节见 [管理工具说明](docs/features/management-mcp.md)。

模型选择：可以说“把当前项目后续任务切换到某模型”。助手先查询可用模型并核对目标，再保存项目模型偏好；当前任务不受影响。固定第三方供应商仍通过安装配置管理。

独立入口分流：纯文本自然语言会先识别目标，项目正在执行时仍可查询状态，或向另一个项目提交任务。不同项目分别执行，同项目继续排队；明确的补充只发送给原任务，目标有歧义则询问。仅管理只读查询可绕过执行队列，不并行修改同一项目。附件、引用及交互提示保持原链路；识别不可用时回退原队列。每条分流会增加一次模型调用。

意图识别优先使用可用的低成本 gpt-6-luna（备选 gpt-5.6-luna），低推理、普通速度；不会继承项目的 Sol 等执行模型。低成本候选不可用时回退原队列，不自动使用更贵模型。固定第三方接入也回退原队列。
