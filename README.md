<div align="center">

# Weixin Link

**离开电脑，也能用微信让 Codex 继续干活。**

发任务 · 补充要求 · 查看进度 · 接收文件

[简体中文](README.md) | [English](README.en.md)

[快速开始](#快速开始) · [使用场景](#使用场景) · [常用命令](#常用命令) · [安装与升级](#安装与升级)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

Weixin Link 把微信私聊接到你电脑或服务器上的 **Codex**。离开工位后，你仍能发起任务、继续补充要求，并在微信里收到回答和生成的文件。

```mermaid
flowchart LR
    A["📱 微信：发送任务、图片或文件"] --> B["Weixin Link"]
    B --> C["💻 你的电脑 / 服务器：Codex 执行"]
    C --> D["📱 微信：接收回答与文件"]
```

*工作流程示意；并非真实聊天截图。电脑或服务器需要保持在线，执行范围取决于工作区与工具权限。*

## 快速开始

**一行启动安装 → 微信扫码 → 发送「安装向导」。** 需要自己的微信和可用的 Codex 账号及模型权限；Node.js 24+ 由安装器按需准备。

**Linux / macOS**：在电脑终端执行：

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/bootstrap.sh)"
```

**Windows x64**：在 PowerShell 执行：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/bootstrap.ps1')))
```

用微信扫描安装器提供的二维码并确认，然后发送 **安装向导**，按提示完成 Codex 安装、登录和模型测试。完成后，直接发一句任务需求即可。

> 扫码成功表示微信通道已连接；向导中的模型测试通过后，才能确认 Codex 可以处理请求。安装遇到问题时，发送 **安装状态**。

<details>
<summary>平台支持与安装要求</summary>

| 平台 | 支持架构 | 要求与验证状态 |
| --- | --- | --- |
| Linux | arm64 / x64 | 用户级 systemd 会话及 flock；已有部署验证 |
| macOS | Apple Silicon / Intel | 已登录的图形会话；已验证扫码和文字收发，完整验收仍在进行 |
| Windows | x64 | 当前用户计划任务、允许运行 PowerShell 脚本；待完整真机验收 |

Linux/macOS 需要 curl、tar；安装私有 Node.js 时还需要 SHA-256 校验工具。安装器验证官方校验和，不覆盖系统 Node.js。Windows ARM64 暂不支持，安装器不修改持久执行策略。

项目仍处于 Preview 阶段，尚无稳定版本兼容承诺。更多要求与维护步骤见 [配置说明](CONFIGURATION.md)。

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
- **执行过程可掌握**：查询状态、补充要求、停止任务，或核对未确认的结果。
- **部署在自己的环境**：接入服务、会话和凭据由你管理；模型请求与微信通信仍经过相应外部服务。

## 常用命令

普通需求直接发送即可。下面这些是固定控制命令：

| 命令 | 用途 |
| --- | --- |
| `状态` | 查看当前任务与队列 |
| `补充 内容` | 向正在执行的任务追加要求 |
| `停止` | 取消当前任务与排队消息 |
| `结果` | 取回最近结果，不重新执行任务 |
| `恢复` | 核对已经提交、但结果尚未确认的任务 |
| `新建 名称` / `列表` | 新建对话、查看对话列表 |
| `安装状态` / `安装向导` | 检查配置、继续安装与登录 |
| `使用说明` | 查看完整帮助 |

每条消息独立处理，同一条中的文字和附件一起提交。会话管理、附件限制和诊断命令见 [使用指南](USER-GUIDE.md)。

## 安装与升级

**重复安装不会自动升级。** 安装入口会优先识别已注册服务，避免重复安装或覆盖已有配置。源码默认位于 `~/.local/share/weixin-link/source`；工作区和账号数据独立保存。

标准安装通过独立的 `upgrade.sh` / `upgrade.ps1` 升级：准备新版与依赖、备份旧源码和运行数据、切换后检查服务；检查失败则尝试自动回滚。**自定义服务、独立发布目录和本地修改需要使用原部署流程，升级器不会自动接管。**

升级命令、自定义安装路径、二维码刷新与恢复步骤见 [已有安装与独立升级](CONFIGURATION.md#已有安装与独立升级)。

<details>
<summary>从源码手动安装</summary>

```sh
git clone https://github.com/zhangjingwei/weixin-link.git
cd weixin-link
```

Linux/macOS 执行 `./install.sh`；Windows PowerShell 执行 `.\install.ps1`。

</details>

## 重新获取登录二维码

Linux/macOS 已安装但尚未登录时，执行下面一行即可刷新二维码，无需切换目录或重新安装：

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

本机图形终端会尝试打开 PNG 图片；SSH 或无图形界面的交互终端会直接显示可扫描二维码，并保留 PNG 路径备用。默认不停止运行中的账号；本地就绪不代表微信绑定仍有效。已解绑时，在命令前加 `WEIXIN_LINK_RELOGIN=1` 可安全停止账号服务并重新获取登录二维码。自定义源码目录用 `WEIXIN_LINK_DIR` 指定，多账号可用 `WEIXIN_LINK_ACCOUNT` 指定；详见 [二维码维护](CONFIGURATION.md#二维码维护)。

## 更多能力与文档

当前支持的智能体底座是 **Codex**。可按需配置多微信账号、远程主机，以及 Linux 独立容器；这些扩展不要求在首次安装时完成。

- [使用指南](USER-GUIDE.md)：会话、模型、记忆、附件与结果。
- [配置与维护](CONFIGURATION.md)：安装、升级、备份和故障处理。
- [远程连接](src/remote/README.md)：连接已授权的远程工作区。
- [可选集成](src/integrations/README.md)：HA 只读查询，按账号显式启用；新闻与备份统一接入仍待迁移。
- [配置示例](config-templates/)：部署配置参考。
- [参与贡献](CONTRIBUTING.md)：问题反馈与代码贡献。

## 安全与许可

使用自己的微信扫码，不要分享登录二维码或设备验证码。Codex 登录在官方 OpenAI 授权页面完成；只授权智能体访问你允许的工作区和服务。安全问题请参阅 [安全政策](SECURITY.md)。

本项目采用 [MIT License](LICENSE)。第三方依赖与外部服务遵循各自条款，见 [第三方许可](THIRD_PARTY_NOTICES.md)。Weixin Link 是独立项目，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。
