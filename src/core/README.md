# Core modules

Core coordinates intake, tasks, conversations and delivery. Transport and model protocol
implementations stay in `src/wechat`, `src/remote` and `src/base`.

The message entry and execution boundaries are documented in
[`docs/architecture/README.md`](../../docs/architecture/README.md). The pure
`intake/message-intent.mjs` selects an application intent from injected parsers;
the WeChat parser registry and SDK Controller live in `src/wechat`.

- `conversations/`: command parsing, official catalog synchronization, archive/delete/selection operations, ordered delivery and history rendering. `text-conversations.mjs` remains the public facade and owns shared state and locks.
- `intake/`: SQLite inbox/jobs, ingress tracing, local turn reconciliation and remote recovery. `durable-intake.mjs` owns queue workers and cancellation checks.
- `tasks/`: cancellation generations, lifecycle projections, attachment context, task-flow markers and recovery states.
- `delivery/`: delivery errors, notification policy and task labels.
- `diagnostics/`: redacted diagnostic logging and commands.
- `runtime/`: account-scoped control endpoint and maintenance leases.
- `schedules/`: account-scoped one-time, daily and weekly schedules. A schedule either sends fixed reminder text or submits a configured prompt to the existing durable Codex task queue.
- `updates/`: checks stable GitHub Releases against the installed semantic version and sends one approval prompt per newer version; it never starts an upgrade.
- `policy/`: assistant policy source.
- `storage/`: shared registry locking and atomic JSON persistence.
- `remote-tasks/`: remote coordination facade, path policy, submission/reconciliation, stopping/terminal cleanup, artifact export, progress delivery and RPC adaptation.

Root-level entry points are retained for compatibility. New implementation imports use
the domain paths. Extracted operations receive their facade explicitly as `context`;
state is not copied and no prototype mutation or additional state store is introduced.
Cross-module calls go through the facade so existing hooks and injected test doubles
continue to work.

## Invariants during changes

- Inbox acknowledgement and job insertion remain in the same SQLite transaction.
- Uncertain submissions are reconciled using the original client message ID, never replayed.
- Official thread state remains authoritative for archive/delete operations.
- Delivery remains serialized per real recipient; uncertain sends are not blindly replayed.
- Cancellation scopes, project locks, task ownership and terminal baselines are shared.
- Artifact path checks and symlink rejection happen before file reads.

Run `npm test`, `npm run check:codex-input`, and, after staging the intended changes,
`npm run check:release`. Tests use mocked remote RPC; they do not establish live host,
WeChat delivery or Windows/macOS runtime verification.

## Personal host concurrency and project directories

Host backends intentionally share the OS user's filesystem. Different accounts
and conversations can execute concurrently, including in the same directory.
DurableIntake serializes each conversation's queue; delivery remains serialized
per real recipient, and cancellation stays scoped to the originating conversation.
There is no global host execution gate or default local project write lock.

Concurrent edits to the same files can conflict. Separate worktrees can separate
code edits; use the existing isolated backend when an execution boundary is
needed. Isolation still depends on mounts and OS permissions. Conversation
separation alone does not isolate files. Existing remote-task coordination and
service/configuration maintenance locks are unchanged.

A newly created project can store a canonical workspace before its first thread
connection. Existing threads retain their old directory. The same workspace is
used for RPC creation, thread start/resume, Claude workspace guidance and output
packaging. Project labels and directory authorization remain distinct.

The experimental global gate from f8146f1 is removed. Its reservation file is no
longer read and does not block execution; this does not reconcile old tasks or
prove their processes stopped. Drain experimental services and verify unfinished
tasks before replacing them. This change does not delete private runtime files.

Background chat upgrades preserve the originating `trace_id` in the request and
transaction journal. Failed requests record a bounded error code and stage; raw
subprocess output is not persisted. Upgrade subprocesses prepend the active Node
directory to PATH, and npm is resolved beside that Node rather than via a login
shell. A completed chat reply only confirms scheduling; the upgrade record and
installed release marker establish the deployment result.
