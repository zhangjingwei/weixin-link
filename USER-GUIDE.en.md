Weixin Link User Guide

Send English commands as plain text, without a slash. Commands are case insensitive. Names, requests, and answers can be in any language.

1. First-time setup

1. Follow the installation steps in README.en.md on your computer. In the terminal, choose subscription sign-in, DeepSeek, Qwen, or Kimi. The installer checks the connection and runs a model test. Enter third-party API keys only in the terminal.
2. The installer shows a WeChat login address and tries to open it in your browser. Confirm the login in WeChat on your phone. If asked for a PIN, follow the prompt in the same terminal. The assistant will send a connection message and a short getting-started guide after your first login.
3. If you skipped or did not complete model setup, rerun the installer and choose **Configure model** from the menu.

- `setup`: Show how to start the setup wizard on your computer.

2. Everyday use

Send a message, image, or file and explain what you need. When you reply to a quoted message, the assistant tries to read its text and tells you if it cannot.
Commands that need a name, search term, or request work in two steps: send the command, then reply to its prompt with a separate text message. Images, files, and voice attachments cannot supply that input.
While a prompt is waiting, you can check `guide` or `status` and then continue with your original answer.

Conversations and tasks

- `daily`: Return to your everyday conversation.
- `supplement`: Reply to the prompt with more instructions for the current task.
- `status`: Check the task and message status.
- `progress`: Check the current progress.
- `result`: See the latest result. Attached files may be sent again when you request it again.
- `stop`: Stop the current task and clear queued messages.
- `exit`: Stop and disconnect the current conversation while keeping its history.
- `recover`: Check a submitted task whose result is still uncertain.
- `cancel`: Cancel a command that is waiting for your input.

Service and help

- `help`: List available commands.
- `guide`: Show this guide again.
- `service-status`: Check whether the service is running.
- `restart`: Restart this account's service when it is idle.
- `check-updates`: Show the current version, latest stable release, and update availability without installing. Explicit checks are independent of automatic notification deduplication. Unverified source/custom installations are reported as such.
- `upgrade`: Upgrade a standard installation when it is idle. Custom deployments may not support this command. New-version and completed-upgrade notices include up to five maintained highlights and a link to the full release notes; missing highlights are stated explicitly.

You can also ask for a reminder in ordinary language, such as “Remind me about the meeting tomorrow at 9 AM.” A reminder can send a message or start a scheduled task. It runs on the computer and does not read your phone calendar.

3. Projects and the everyday conversation

Projects and the everyday conversation share one WeChat chat. For `archive`, `restore`, `delete`, and `switch`, send the command first, then reply with a number from its list. The number applies only to that selection.

- `list`: List projects.
- `daily`: Return to the everyday conversation.
- `new`: Enter a name for a new project when prompted.
- `rename`: Enter a new name when prompted.
- `switch`: Show conversations, then reply with the number of the one to use.
- `history`: Show conversations, including archived ones, then reply with a number to read its history.
- `older`: See earlier history.
- `search`: Enter a term to search the latest 50 turns of the current conversation.
- `archive`: List conversations you can archive, then reply with a number. History is kept.
- `restore`: List archived conversations, then reply with a number to restore one.
- `delete`: List conversations you can delete, then reply with a number to permanently delete one and its derived conversations. This cannot be undone.

4. Tasks, reviews, and conversations

Long-running goals and plans

- `goal`: Enter a long-running goal when prompted. Send specific tasks separately.
- `goal-status`: Check the goal's status.
- `goal-pause`: Pause the goal.
- `goal-resume`: Resume the goal.
- `goal-complete`: Mark the goal complete.
- `goal-clear`: Remove the goal record.
- `plan`: Enter a request to make a plan first. After reviewing it, send a separate request to carry it out.

Code reviews

- `review`: Review uncommitted changes in the current workspace.
- `compare`: Enter a branch name, such as `main`, to review changes against that branch.
- `commit-review`: Show recent commits, then reply with the number of the commit to review.

Conversation management

- `session-status`: Check the current conversation and goal status.
- `resume-session`: Show saved conversations, then reply with a number to switch to one.
- `reset-session`: Start a new conversation for the current project.
- `compact`: Condense the current conversation context.
- `fork`: Copy the current conversation and switch to the copy.
- `branch`: Create a branch while keeping the current conversation active. You can switch to the branch later.

Models and memory

- `models`: List models.
- `fast-on`: Use fast mode for later tasks.
- `fast-off`: Turn off fast mode.
- `memory`: Check memory status.
- `memory-on`: Enable memory for the current conversation.
- `memory-off`: Disable memory for the current conversation.

Approvals and answers

When the assistant asks for approval or more information, choose an item from the list:

- `approve`: Show pending approvals, then reply with a number to approve one.
- `reject`: Show pending approvals, then reply with a number to reject one.
- `answer`: Show pending questions, reply with a number, then enter your answer.

5. Images and files

Send images, files, PDFs, or videos and explain what you want done. The assistant will tell you if it cannot read the content in full.
The assistant can send up to 8 files at once, with a combined size of 50 MB. Follow its prompt if a file is too large or cannot be received.
MP3 and WAV audio is shown as files. Use a private WeChat chat; ordinary group chats are not supported.

6. Other computers and backups

To connect another computer or home device, or to set up backups, describe what you want and follow the assistant's reply. Do not send passwords or API keys through WeChat.

7. Troubleshooting

If WeChat says it cannot connect or the assistant does not respond as expected, use the relevant command:

- `service-status`: Check whether the service is online.
- `diagnose`: Check diagnostics for the current account.
- `recent-errors`: See recent error messages.
- `export-diagnostics`: Create a report to share for troubleshooting.
- `setup-status`: Check setup and sign-in if messages arrive but tasks do not run.
- `status`: Check whether a task is running.
- `result`: Check the latest result before sending a task again.
- `install-help`: Show installation help.

8. Working in a chosen folder

- `folder`: See which folder the assistant is using.
- `new-project`: Enter a project name, then choose the current folder or one of its subfolders from a list.
- `stop`: Stop only the current conversation's task.

Projects can share a folder. If they edit the same file at the same time, their changes may conflict; check whether another task is still running. A voice message with a complete text transcript can also contain a command.
