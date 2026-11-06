<div align="center">

# Zero Link

[简体中文](README.md) | [English](README.en.md)

**Continue your computer's Codex work from WeChat.**

Start tasks · Add instructions · Check progress · Receive files

[Quick start](#quick-start) · [Everyday use](#everyday-use) · [Configuration](CONFIGURATION.md) · [User guide](USER-GUIDE.md) · [Contributing](CONTRIBUTING.md)

![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417E38)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
![Status: Preview](https://img.shields.io/badge/Status-Preview-orange)

</div>

Zero Link connects WeChat private chats to your Codex deployment. Describe a task using text, images, or files. The agent works in your configured environment and sends progress, answers, and generated files back to WeChat.

Your computer must stay online. **Codex** is the currently supported backend. The Claude and OpenCode directories are placeholders; those integrations are not available yet.

> **Preview:** There is no stable-version compatibility guarantee yet. macOS and Windows support has been implemented, but full testing of QR pairing, message exchange, and task cancellation on actual devices remains incomplete. See the requirements below and [configuration and release guidance](CONFIGURATION.md). Linked supporting guides are currently in Chinese.

## What you can do

Example requests follow. What the agent can actually execute depends on your workspace, tool permissions, and access to services:

```text
Find out why this project's tests are failing, fix the problem, and explain what changed.

[Attach a PDF]
Extract the key dates, amounts, and action items from this document.

Send the results as a CSV file.

补充 Keep the existing interface and add a compatible implementation first.
```

- **Continue the same work:** Persistent conversations, history, conversation switching, and additional instructions while a task is running.
- **Work with attachments and receive files:** Images, PDFs, Office documents, and videos as input; images, spreadsheets, documents, and other generated files as output.
- **Check status and stop tasks:** Inspect execution and delivery status, cancel the current task and queued messages, and reconcile uncertain outcomes before submitting again.
- **Connect your own environments:** Local Codex, configured remote hosts, and optional isolated containers on Linux.
- **Manage multiple WeChat accounts independently:** Each account has separate credentials, authorized users, conversations, queues, and logs.

## Quick start

### 1. Check the requirements

You need an internet-connected computer, WeChat for scanning the pairing QR code, and a working Codex account with model access. Perform the initial installation in a computer terminal. After pairing, you can continue configuration through WeChat.

| Platform | Architecture | Background service | Status |
| --- | --- | --- | --- |
| Linux | arm64 / x64 | User-level systemd | Existing deployment path |
| macOS | Apple Silicon / Intel | User launchd service | Implemented; full device testing pending |
| Windows | x64 | Task Scheduler under the current user | Implemented; full device testing pending |

The runtime requires **Node.js 24+ and npm**. If the installed Node.js version is unsuitable, the installer attempts to install a private copy verified against official checksums, without replacing your system installation.

Linux requires a working user-level systemd session and `flock`. Downloading Node.js on Linux or macOS also requires `curl`, `tar`, and a SHA-256 verification tool. macOS needs a logged-in graphical session. Windows must permit local PowerShell scripts; the installer does not change the execution policy. Windows ARM64 is not currently supported.

### 2. Install and pair WeChat

The repository is public. For a first installation, run the command for your platform to download `main` and launch its installer. You do not need to clone the repository first.

**Linux / macOS**

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhangjingwei/zero-link/main/bootstrap.sh)"
```

**Windows x64 (PowerShell)**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/zero-link/main/bootstrap.ps1')))
```

The Windows bootstrap uses `ExecutionPolicy Bypass` only for the installer child process. It does not change the persistent user or system execution policy.

Both scripts save source code to `~/.local/share/zero-link/source` by default (the `.local\share\zero-link\source` directory under your Windows user profile), then invoke `install.sh` or `install.ps1`. Set `ZERO_LINK_DIR` to choose a source directory or `ZERO_LINK_REF` to select a branch, tag, or commit. They refuse to overwrite an existing destination. These commands are for first installations, not for directly updating an existing deployment. Source code, the workspace, and account data are stored separately.

<details>
<summary>Install from a manual clone</summary>

```sh
git clone --branch main https://github.com/zhangjingwei/zero-link.git
cd zero-link
```

Linux / macOS:

```sh
./install.sh
```

Windows PowerShell:

```powershell
.\install.ps1
```

</details>

The installer prepares private directories, the workspace, dependencies, and a background service, then starts pairing and displays a QR code. Scan and confirm it in WeChat. The person who confirms becomes the account profile's initial authorized user.

To display the QR code again on Linux or macOS, run `./wechat-setup qr` from the installation directory. With the default bootstrap layout, first change to `~/.local/share/zero-link/source`; use your chosen directory for a custom installation. See [QR code maintenance](CONFIGURATION.md#二维码维护) for refreshing an expired code.

### 3. Complete Codex setup in WeChat

Send **`安装向导`** (setup wizard), then reply with `1`, `2`, or `3` according to the current screen. You can choose the local environment during initial setup. `3` exits while keeping completed steps. Complete device authorization only on the official OpenAI page; do not paste tokens into the chat.

The wizard checks installation, authentication, and the official protocol, then offers an actual model test. **Successful QR pairing only confirms that the WeChat channel is connected. A successful model test confirms that inference works for that test.**

Send a normal request to begin. For help, send `使用说明` (user guide). If setup fails, send `安装状态` (installation status).

## Everyday use

Each WeChat message is processed independently. Text and attachments in the same message are submitted together. Send them directly; an attachment without text is also submitted for inspection. If a quoted message lacks its original text, the assistant says so and does not automatically retrieve historical quoted attachments.

Built-in chat commands currently use the Chinese keywords shown below; explanatory English labels are not command aliases. Ordinary task requests can be written in English.

| Action | Command |
| --- | --- |
| Inspect task, queue, and delivery status | `状态` |
| Add instructions to the active task | `补充 your additional instructions` |
| Stop the current task and clear its queue | `停止` |
| Retrieve the latest result without executing again | `结果` |
| Reconcile a submitted task with an uncertain outcome | `恢复` |
| Create a conversation | `新建 name` |
| Stop and disconnect while keeping history | `退出` |
| Show help | `帮助` |

Use `列表` to list conversations, `新建 name` to create one, `切换2` to switch, `命名 name` to rename, `历史` to read history, and `搜索 keyword` to search. `归档2` archives a conversation while retaining its history; `还原2` restores it. **`删除2` permanently deletes the conversation and its derived child conversations. It cannot be undone.** Use the numbers shown in your actual conversation list.

`模型` queries the official model catalog. `记忆` checks native memory status; `开启记忆` and `关闭记忆` control the current conversation's memory mode. Memory defaults to enabled when a conversation is created or reconnected. It is isolated by the Codex data directory and is not guaranteed to retain every detail. See the [user guide](USER-GUIDE.md).

## How it works

```text
WeChat private chat
   ↕ Messages and attachments
Zero Link: authorization · durable queues · conversations · result delivery
   ↕ Official protocol
Codex app-server
   ↕ Tools and workspace
Local projects / configured remote hosts / optional isolated containers
```

The integration layer manages messages and task lifecycles. Official Codex handles reasoning and the tool loop. The agent determines the intended project from your request and verifies the environment; the integration layer does not automatically execute tasks through a project-alias table.

Receipt, execution, and delivery have separate states. After a restart, unsubmitted messages can resume. For submitted tasks with unknown outcomes, the original turn is queried instead of blindly submitting another task. Stopping affects only tasks and remote commands owned by the current conversation, without globally stopping shared services. API acceptance does not prove that a user has read, played, or seen a message in their client.

## Configuration and integrations

Ask in WeChat, for example, “Help me configure a remote host” or “Check my home device connection.” The agent inspects the existing setup, asks for necessary missing information, and uses configuration commands to make the requested changes. This workflow requires a working model; you do not need to edit runtime JSON manually or memorize configuration commands.

Examples are in [`config-templates/`](config-templates/). Actual credentials, conversations, and attachments stay in private directories. A private `installation.json` controls the workspace path. Put personal instructions in the workspace's `AGENTS.md`; the program only updates clearly marked managed sections.

- **Multiple accounts:** Each account is paired and authorized separately. Credentials are not copied from the primary account, and an old profile cannot be rebound to another account to inherit its conversations.
- **Remote Codex:** The agent checks SSH access, host settings, and allowed root directories before connecting to a remote project. See [remote connections](src/remote/README.md).
- **Containers on Linux:** Require rootless Podman, Quadlet, and cgroup v2 memory controls. Authenticate inside each container; host Codex credentials are not copied into it.
- **Home Assistant:** Supports read-only queries after configuration.
- **Encrypted backups on Linux:** Configure the target and keys separately. No NAS is connected by default.

Example requests:

```text
Add a remote host for me. Check the connection first.
Check whether my home device connection works.
Create a second bot account and send me its pairing QR code.
Show the status of my bot accounts.
```

The agent checks existing settings, gathers necessary information, and calls the configuration or account-management interface. You still complete QR scanning and login authorization yourself. You do not need an IDE or text editor to manually change server configuration files.

## Attachments and results

| Input | Processing |
| --- | --- |
| Images | Inspect image content |
| PDF | Extract text and inspect page images |
| DOCX, PPTX, XLSX | Extract document, slide, and spreadsheet text |
| Video | Analyze sampled frames |
| Voice messages | Use the transcript supplied by WeChat |

Results can be plain text or actual files: images, H.264 MP4, PDF, ZIP, TXT, Markdown, CSV, JSON, Word, Excel, and PowerPoint. MP3, WAV, and SILK are delivered as audio files.

Incoming messages support up to 10 attachments totaling 50 MiB. Each outgoing group supports up to 8 files totaling 50 MiB. See the [user guide](USER-GUIDE.md) for processing ranges and format requirements.

## Troubleshooting

**WeChat is online but there is no answer?** Send `安装状态` and follow the instructions to install, authenticate, or verify Codex.

**Execution or delivery is uncertain?** Check `状态`, then use `恢复` to reconcile if needed. Avoid submitting the same task again. Use `结果` to retrieve saved output; retransmission may include attachments previously accepted by the API.

**The container is not ready?** Check `安装状态`. Use `启动容器` or `登录智能体` as appropriate, and address any missing system prerequisites reported by the checks.

**Diagnostics without a working model:** Send `运行诊断` (run diagnostics), `服务状态` (service status), `查看最近错误` (recent errors), or `导出诊断报告` (export a report). These commands inspect the current account's local diagnostic logs and service state without calling a model. Reports are delivered as redacted JSON files.

## Security and pairing

- Obtain installation scripts and source code from this repository's `main` branch.
- Confirm pairing with your own WeChat account. The person who confirms becomes the profile's initial authorized user. Do not share login QR codes or device authorization codes.
- Authenticate Codex on the official OpenAI authorization page. Configuration and credentials stay in the deployment owner's private runtime directories.
- QR codes have a conservative local display window of 90 seconds. An online account is not paired again. See the [security policy](SECURITY.md) for reporting issues.

## Documentation and license

[User guide](USER-GUIDE.md) · [Configuration and release boundaries](CONFIGURATION.md) · [Contributing](CONTRIBUTING.md) · [Security reports](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

The project's own code and documentation are licensed under the [MIT License](LICENSE). Third-party dependencies, optional binaries, and external services have their own terms. Zero Link is an independent project and is not an official product of, or endorsed by, WeChat, OpenAI, or other service providers.
