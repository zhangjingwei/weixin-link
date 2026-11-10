<div align="center">

# Weixin Link

**Your own AI assistant, right in WeChat.**

Research, plan, and get results.

[简体中文](README.md) | [English](README.en.md)

[Quick start](#quick-start) · [Use cases](#use-cases) · [Common commands](#common-commands) · [Installation and upgrades](#installation-and-upgrades)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

**Security & privacy:** Install it on your own computer; your account and keys stay under your control.

**Personal assistant:** Your own AI with memory, getting more useful the more you use it.

**Smarter AI:** Choose the model; the agent does the work. It plans, uses tools, and takes complex tasks from start to finish.

<table align="center">
  <tr><th align="center">Clarify a city · Check the weather</th><th align="center">Transcribe speech · Write a story</th></tr>
  <tr>
    <td align="center" valign="top"><img src="docs/images/weather-conversation.png" width="320" alt="WeChat conversation: asking for a city before checking the weather"></td>
    <td align="center" valign="top"><img src="docs/images/voice-story-conversation.png" width="320" alt="WeChat conversation: transcribing a voice message and writing a short story"></td>
  </tr>
  <tr><th align="center">Check available devices</th><th align="center">Compare device readings</th></tr>
  <tr>
    <td align="center" valign="top"><img src="docs/images/available-devices-conversation.png" width="400" alt="Illustrative WeChat conversation: checking authorized SSH and Home Assistant devices"></td>
    <td align="center" valign="top"><img src="docs/images/temperature-conversation.png" width="400" alt="Illustrative WeChat conversation: checking temperature and explaining differing device readings"></td>
  </tr>
</table>

<p align="center"><sub>Illustrations adapted from actual conversations. Device names, counts and readings have been replaced; available capabilities depend on current permissions.</sub></p>

## Quick start

**Run the installer → choose and verify a model in the terminal → open the WeChat login address and confirm → receive the connection result.** You need your own WeChat account and a Codex subscription or supported model service. The installer prepares Node.js 24+ if needed.

**Linux / macOS** — run in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

**Windows x64** — run in PowerShell:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

The installer first prompts you to choose subscription sign-in, DeepSeek, Qwen or Kimi. After the model test, the installer shows a WeChat login address and tries to open it in your browser; the assistant then reports the installation result. Enter third-party API keys only in the terminal. Installation steps, WeChat login prompts, and setup commands support Chinese and English. Some advanced maintenance and diagnostic messages remain in Chinese.

**For users in mainland China:** [Codex subscription sign-in](https://learn.chatgpt.com/docs/auth) requires your own account and a connection to OpenAI services. If OpenAI is unavailable from your location or network, this option will not work. DeepSeek, Qwen and Kimi use keys from their own platforms instead of Codex subscription sign-in. Confirm your choice with the setup wizard's model test.

The setup wizard automatically uses Chinese or English.

> Pairing confirms only the WeChat connection. The terminal model test confirms whether the assistant can handle tasks. If setup needs attention, send **setup-status**.

<details>
<summary>Platform support and requirements</summary>

| Platform | Architectures | Requirements and validation |
| --- | --- | --- |
| Linux | arm64 / x64 | Validated in an existing deployment |
| macOS | Apple Silicon / Intel | Logged-in graphical session; pairing and text exchange verified, full validation ongoing |
| Windows | x64 | Permission to run PowerShell scripts; full device testing pending |

Linux/macOS require curl and tar. Windows ARM64 is not supported.

[v1.3.3](https://github.com/zhangjingwei/weixin-link/releases/tag/v1.3.3) is released, with no long-term version compatibility guarantee yet. See [configuration and maintenance](CONFIGURATION.md) for details.

</details>

## Use cases

These are example requests. Execution depends on your configured workspace, tools and service access.

| What you need | What to send in WeChat |
| --- | --- |
| **Keep working on code away from your desk** | “Find the failing tests in this project, fix them, and explain what changed.” |
| **Add requirements while a task runs** | Send `supplement`, then reply: “Keep the existing interface and add a compatible implementation first.” |
| **Send material from your phone** | Attach a PDF: “Extract the key dates, amounts and action items.” |
| **Receive a usable file** | “Turn the results into a CSV file and send it to me.” |

- **Continue the same work:** Persistent conversations and task state, with switching between conversations.
- **Send more than text:** Images, PDFs and Office documents as input; text, images and generated files as output.
- **Stay in control:** Check progress, add instructions or stop tasks from WeChat.

## Common commands

Send ordinary tasks directly. For commands such as `new`, reply to the assistant's follow-up prompt. Send `cancel` to cancel a pending prompt. English commands do not need a slash.

| Command | Purpose |
| --- | --- |
| `daily` | Return to the fixed everyday conversation |
| `status` | Check the current task and queue |
| `progress` | See what the assistant is working on now |
| `supplement` | Add instructions to the current task |
| `stop` | Stop the current task |
| `result` | See the latest result |
| `new` | Create a project |
| `list` | List projects |
| `plan` | Ask the assistant to make a plan first |
| `review` | Review current project changes |
| `guide` | See the full English guide and more commands |

See the [English user guide](USER-GUIDE.en.md) for branch or commit reviews, saved sessions, attachments and troubleshooting.

## Installation and upgrades

To upgrade, rerun the installation command in [Quick start](#quick-start) and choose **Upgrade**. Standard installations also prompt you when a stable update is available and upgrade only after you confirm. See [configuration and maintenance](CONFIGURATION.md#已有安装与升级) for custom deployments and recovery.

The installer guides you through the first WeChat login. To log in again later, rerun the same installation command and choose **Log in to WeChat again** from the menu. You do not need to find the installation directory.

**Linux / macOS**:

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

**Windows x64**:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

To add another WeChat account, choose **Add WeChat account**. See [WeChat login maintenance](CONFIGURATION.md#微信登录维护) for other cases.

To uninstall, rerun the same command, choose **Uninstall**, and confirm. Account data and the workspace are kept.

## More capabilities and documentation

- [User guide](USER-GUIDE.en.md): conversations, models, memory, attachments and results.
- [Configuration and maintenance](CONFIGURATION.md): installation, upgrades, backups and troubleshooting.
- [Remote connections](src/infrastructure/remote/README.md): connect authorized remote workspaces.
- [Configuration examples](config-templates/): deployment references.
- [Contributing](CONTRIBUTING.md): report issues and contribute changes.

Optional integrations: [Home Assistant read-only queries, SSH remote operations, and RSSHub feeds](src/integrations/README.md) require explicit per-account enablement. Backup migration to this interface remains pending.

## Security and license

Confirm login with your own WeChat account. Do not share login addresses or device authorization codes. For subscription sign-in, use the official OpenAI authorization page. Grant access only to the workspaces and services you intend to use. See the [security policy](SECURITY.md) for reporting issues.

Licensed under the [MIT License](LICENSE). Third-party dependencies and external services have their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md). Weixin Link is an independent project, not an official product of, or endorsed by, WeChat, OpenAI or other service providers.
