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

Projects retain their own directories, context and queues. Labelled progress, approval prompts and results return to the same WeChat entry. Queued does not mean completed. Background results are not automatically inserted into the current model context; the assistant queries task results when asked to summarize. Reliable voice transcripts work as text. Current-message attachments can be explicitly handed to a named project through private snapshots; historical attachments are not implicitly forwarded.

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

Model selection: ask to use an available model for a project’s future tasks. The assistant validates the exact model ID and saves a project-scoped preference without interrupting the current turn. Fixed third-party providers remain managed through installation configuration.

Independent entry routing classifies plain-text requests before project execution. Status/history/result reads bypass busy project queues; tasks for different projects can run separately, while each project remains sequential. Supplements bind to the original task and ambiguous targets require clarification. Current attachments and quotes can be explicitly handed off; interactive prompts and attachment continuations retain their original flow. Classification adds a model call and falls back to the original queue when unavailable.

Intent classification prefers available gpt-6-luna, then gpt-5.6-luna, with medium reasoning and fast service tier (which may increase usage costs). It does not inherit the project execution model. If no budget candidate is available, or a fixed third-party provider is configured, it falls back to the original queue instead of selecting a premium model.

Task messages show the project name and a readable task title rather than an internal ID. Intent classification supplies a concise Chinese title; existing tasks fall back to a short excerpt of the original request. Progress and results retain the same title, while internal IDs remain available for reconciliation.

The unified entry also supports evidence-backed progress, exact stop and pending-queue controls, bounded dependent project plans, and explicit current-attachment handoffs. See [unified entry details](docs/features/unified-entry.md) for recovery, privacy and validation boundaries.
