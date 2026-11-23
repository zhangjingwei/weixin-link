# WeChat assistant user guide

Describe what you need in natural language. You do not need to memorize commands or switch projects first. The assistant clarifies ambiguous project names and targets before acting.

## First connection

Complete model authorization and WeChat sign-in on the installation computer as described in README. Enter API keys only in that terminal. Device authorization and QR confirmation remain user actions. A short guide appears after login.

## One entry, multiple projects

- “What projects do I have?”
- “How far has the knowledge project progressed?” — reads status without switching or creating work.
- “Have the toolbox project improve its search page, keeping the current colors.” — submits a new text task to that project.
- “Add PDF support to the knowledge project's running task.” — supplements the exact original task.
- “Stop the toolbox project's current task.” — verifies the target without stopping other projects.
- “Show the knowledge project's previous result.” — reads it; files are resent only on an explicit request.

Projects retain their own directories, context and queues. Labelled progress, approval prompts and results return to the same WeChat entry. Queued does not mean completed. Background results are not automatically inserted into the current model context; the assistant queries task results when asked to summarize. Reliable voice transcripts work as text. Cross-project submissions currently accept text only; attachments are not implicitly transferred.

## Projects, history and schedules

Ask to create or rename a project, search its discussions, archive a finished project or restore an archived project. Creation first confirms an existing directory and does not switch. Archiving preserves history rather than permanently deleting it. Archiving the current project moves navigation to another available project under the existing rules.

Ask for a reminder tomorrow, a recurring project task, your schedule list or cancellation of a specific reminder. Ambiguous times, time zones and targets are clarified. Cancellation stops future triggers, not tasks already submitted.

## Updates and maintenance

Ask whether a release is available to check without installing. Ask to skip that particular version to retain notifications for later releases. Explicitly requesting an upgrade binds the checked version and commit. After the tool receipt, the existing worker waits for the shared installation to become idle, then backs up, upgrades and checks health. Accounts sharing that installation are affected; a later release is not silently substituted.

Ask to restart the current account to schedule an idle restart after the tool receipt. Running work is not forcefully interrupted. Ask whether maintenance finished to inspect the worker's actual record; scheduled does not mean completed.

## Troubleshooting and other work

Ask whether the service is healthy, what is missing from installation, for recent errors, or how to use the assistant. Diagnostics expose only sanitized current-account information. Installation checks are not proof of a new successful inference.

Describe plans, code reviews and other work directly for the configured agent to handle. Management MCP exposes no arbitrary RPC, recipient or generic command execution interface. User approvals, API key input and interactive sign-in remain explicit user actions.

## When the model is unavailable

Exact commands remain handled by the bridge:

- **stop**: stop the current conversation and clear its queue; identify other projects explicitly.
- **status**: inspect current conversation and task status.
- **install-help**: installation and authorization guidance.
- **service-status**, **guide**, **help**: service status, this guide and the full manual command entry.

See the [exact command reference](docs/reference/commands.en.md) for recovery procedures. Natural-language management requires the enabled MCP and Skill; exact commands remain available if those are unavailable.
