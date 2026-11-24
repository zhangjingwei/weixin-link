# WeChat assistant user guide

Describe what you want to do. You do not need to memorize commands or switch conversations to work on another project. Replace the example names below with your own projects.

## Getting started

Follow the [README](README.en.md#quick-start) on the installation computer. Complete model authorization and WeChat sign-in yourself; enter API keys only there. A short guide appears after login. Keep that computer running and connected.

## Assign work and check progress

- “What projects do I have?”
- “How far has the knowledge project progressed?” — see recent results, current work, recorded blockers and waiting tasks. Missing information is stated rather than turned into a made-up completion percentage.
- “Have the toolbox improve search, keeping the current colors.”
- “Have the knowledge project check search and the toolbox improve its page.” — up to 5 tasks per request.
- “First have the knowledge project prepare requirements, then have the toolbox implement them.” — later tasks wait if earlier work fails or has an uncertain result.

Results return with the project name and a readable task title. Different projects can work separately; each project's tasks run in order. Unclear targets are clarified. Queued or scheduled does not mean finished.

## Add instructions, stop or reorder work

- “Add PDF support to the knowledge project's running task.” — adds to that task rather than starting another.
- “Stop the toolbox's current task.” — stops that task and clears that project's waiting queue, not other projects. Wait for the final stop result.
- “Cancel the knowledge project's search repair task that has not started.”
- “Cancel all waiting tasks in the knowledge project.” — cancels waiting work without stopping running tasks. The assistant tells you if a task has already started.
- “Move search repair to the front.” — reorders waiting work without interrupting running work or bypassing dependencies.

## Send material and receive files

Attach a supported image, PDF or document and name the project that should analyze it. If the assistant asks which project you mean, your answer continues that request with its original attachment. Older attachments are not reused automatically; identify them explicitly.

User-facing reports, JSON and HTML files are returned as WeChat attachments. Download HTML and open it in a browser; open JSON in a text editor. Mentioning a source-code location does not send that file, and the assistant does not automatically bundle a whole repository or account configuration.

Ask to see a previous result to read it, or explicitly ask to resend its original files. Temporary delivery files use private storage. After successful sending, temporary copies remain available for resending for up to 7 days. Expired files may no longer be available. See [file delivery details](docs/artifact-delivery.md) (Chinese).

## Projects, history and reminders

Ask to create or rename a project or search its past discussions. Creation confirms an existing working directory and does not switch conversations. Archiving a project keeps its history and can be undone.

Ask for a reminder tomorrow, a daily project task, a list of plans or cancellation of a reminder. Unclear times and targets are clarified. Cancelling a plan removes future runs, not tasks already submitted. Scheduled work needs the service to remain running.

## Choose a model

Ask which models are available, then name the model for a project's future tasks. The change does not interrupt current work or change other projects. Similar model names require clarification. Configure third-party model services through the installer.


## Updates and troubleshooting

- Ask whether a new release is available to see its main changes without installing.
- Ask to skip that version to keep notifications for future versions.
- Ask to upgrade to the checked version. The service waits for idle, backs up, upgrades and checks health. Other accounts sharing the installation are affected too. Scheduled is not completed: wait for the result.
- Ask to restart the current account; it waits for idle.
- Ask whether the upgrade finished, whether the service is ready, or what recent errors occurred.

If the model cannot answer, use these emergency commands:

- **stop**: stop the current conversation's task and clear its waiting queue.
- **status**: check the current conversation and task.
- **install-help**: installation and authorization guidance.
- **service-status**, **guide**, **help**: service status and usage information.

See the [exact command reference](docs/reference/commands.en.md) for recovery. If natural-language controls are unavailable, use the manual commands. See [unified entry details](docs/features/unified-entry.md) for technical limits.
