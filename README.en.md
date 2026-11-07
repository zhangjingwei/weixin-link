<div align="center">

# Weixin Link

**Away from your computer? Keep your agent working through WeChat.**

Start tasks · Add instructions · Check progress · Receive files

[简体中文](README.md) | [English](README.en.md)

[Quick start](#quick-start) · [Use cases](#use-cases) · [Common commands](#common-commands) · [Installation and upgrades](#installation-and-upgrades)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

Weixin Link connects WeChat private chats to an **agent backend** on your computer or server. It currently supports Codex (the default) and Claude CLI. Start tasks, add instructions while you are away, and receive answers and generated files in WeChat.

<p align="center">
  <img src="docs/images/weather-conversation.png" width="320" alt="WeChat conversation: asking for a city before checking the weather">
  <img src="docs/images/voice-story-conversation.png" width="320" alt="WeChat conversation: transcribing a voice message and writing a short story">
</p>

*Edited from actual conversations: clarify a request, then respond; transcribe a voice message, then write a story. Your computer or server must stay online. Execution depends on your workspace and tool permissions.*

## Quick start

**Run the installer → scan with WeChat → send `安装向导`.** You need your own WeChat account and model access for your chosen agent backend. The installer prepares Node.js 24+ if needed.

**Linux / macOS** — run in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

**Windows x64** — run in PowerShell:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

Scan and confirm the pairing QR code in WeChat, then send **安装向导** (setup wizard). For the default Codex backend, follow the prompts to install, sign in and run a model test. Claude CLI requires a configured executable and service credentials. Once setup is complete, send a task in your preferred language. Setup prompts and fixed control commands are currently in Chinese.

> Pairing confirms only the WeChat connection. Codex is confirmed after the wizard's model test; Claude setup status checks its CLI and credentials, so a real model request still needs separate verification. If setup needs attention, send **安装状态** (setup status).

<details>
<summary>Platform support and requirements</summary>

| Platform | Architectures | Requirements and validation |
| --- | --- | --- |
| Linux | arm64 / x64 | User-level systemd session and flock; existing deployment validation |
| macOS | Apple Silicon / Intel | Logged-in graphical session; pairing and text exchange verified, full validation ongoing |
| Windows | x64 | Current-user Task Scheduler and permission to run PowerShell scripts; full device testing pending |

Linux/macOS require curl and tar, plus a SHA-256 verification tool when installing private Node.js. The installer verifies official checksums and does not replace system Node.js. Windows ARM64 is not supported, and the installer does not change persistent execution policies.

This project is in Preview, with no stable-version compatibility guarantee yet. See [configuration and maintenance](CONFIGURATION.md) for details. Supporting guides are currently in Chinese.

</details>

## Use cases

These are example requests. Execution depends on your configured workspace, tools and service access.

| What you need | What to send in WeChat |
| --- | --- |
| **Keep working on code away from your desk** | “Find the failing tests in this project, fix them, and explain what changed.” |
| **Add requirements while a task runs** | “补充 Keep the existing interface and add a compatible implementation first.” |
| **Send material from your phone** | Attach a PDF: “Extract the key dates, amounts and action items.” |
| **Receive a usable file** | “Turn the results into a CSV file and send it to me.” |

- **Continue the same work:** Persistent conversations and task state, with switching between conversations.
- **Send more than text:** Images, PDFs and Office documents as input; text, images and generated files as output.
- **Stay in control:** Check progress, add instructions, stop tasks and reconcile uncertain results.
- **Run in your own environment:** Manage the bridge, conversations and credentials yourself. Model requests and WeChat communication still use the corresponding external services.

## Common commands

Send **日常助手** to return to your fixed everyday conversation, including after service restarts. Use `新建 Project name` for a separate project, then `日常助手` to return. Existing users keep their original conversation.

Send ordinary requests directly. These fixed commands control the bridge:

| Command | Purpose |
| --- | --- |
| `日常助手` | Return to the fixed everyday conversation |
| `状态` | Check the current task and queue |
| `补充 Your instructions` | Add instructions to the active task |
| `停止` | Cancel the current task and queued messages |
| `结果` | Retrieve the latest result without rerunning the task |
| `恢复` | Reconcile a submitted task whose result is uncertain |
| `新建 Name` / `列表` | Create a conversation or list conversations |
| `安装状态` / `安装向导` | Check setup or continue installation and authentication |
| `切换智能体` / `切换智能体 Codex` / `切换智能体 Claude` | Show the current agent or switch this account after it becomes idle |
| `使用说明` | Read the full user guide |

Each message is processed independently. Text and attachments in the same message are submitted together. See the [user guide](USER-GUIDE.md) for conversation management, attachment limits and diagnostic commands.

## Installation and upgrades

To upgrade, rerun the command for your platform in [Quick start](#quick-start). Automatic upgrades support installer-managed deployments; see [configuration and maintenance](CONFIGURATION.md#已有安装与升级) for custom deployments, QR refresh and recovery.

## Refresh the login QR code

Linux / macOS:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/qr.sh)"
```

Prefix the command with `WEIXIN_LINK_QR_STYLE=full` for solid cells, or `WEIXIN_LINK_RELOGIN=1` to sign in again after unbinding. See [QR maintenance](CONFIGURATION.md#二维码维护).

## More capabilities and documentation

The supported agent backends are **Codex** (default) and **Claude CLI** (explicit setup). Both share WeChat intake, task state and delivery; backend capabilities differ. Claude requires CLI 2.1.259+ and service-side API credentials. It supports local tasks, session continuation and stopping; model catalog, native memory, official history search and permanent deletion are not yet connected. See the [Claude adapter notes](src/base/claude/README.md). Remote hosts and isolated Linux containers currently use Codex paths.

- [User guide](USER-GUIDE.md): conversations, models, memory, attachments and results.
- [Configuration and maintenance](CONFIGURATION.md): installation, upgrades, backups and troubleshooting.
- [Remote connections](src/remote/README.md): connect authorized remote workspaces.
- [Configuration examples](config-templates/): deployment references.
- [Contributing](CONTRIBUTING.md): report issues and contribute changes.

Optional integrations: [Home Assistant read-only queries, SSH remote Codex tasks, and RSSHub feeds](src/integrations/README.md) require explicit per-account enablement. Backup migration to this interface remains pending.

## Security and license

Pair with your own WeChat account. Do not share login QR codes or device authorization codes. Authenticate Codex on the official OpenAI authorization page; provide Claude API credentials through the service environment, never through WeChat. Grant access only to the workspaces and services you intend to use. See the [security policy](SECURITY.md) for reporting issues.

Licensed under the [MIT License](LICENSE). Third-party dependencies and external services have their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md). Weixin Link is an independent project, not an official product of, or endorsed by, WeChat, OpenAI or other service providers.
