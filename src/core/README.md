# Core modules

Core coordinates intake, tasks, conversations and delivery. Transport and model protocol
implementations stay in `src/wechat`, `src/remote` and `src/base`.

- `conversations/`: command parsing, official catalog synchronization, archive/delete/selection operations, ordered delivery and history rendering. `text-conversations.mjs` remains the public facade and owns shared state and locks.
- `intake/`: SQLite inbox/jobs, ingress tracing, local turn reconciliation and remote recovery. `durable-intake.mjs` owns queue workers and cancellation checks.
- `tasks/`: cancellation generations, lifecycle projections, attachment context, task-flow markers and recovery states.
- `delivery/`: delivery errors, notification policy and task labels.
- `diagnostics/`: redacted diagnostic logging and commands.
- `runtime/`: account-scoped control endpoint and maintenance leases.
- `schedules/`: account-scoped one-time, daily and weekly schedules. A schedule either sends fixed reminder text or submits a configured prompt to the existing durable Codex task queue.
- `updates/`: checks the installer-recorded GitHub `main` commit and sends one approval prompt per newer commit; it never starts an upgrade.
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

## Host execution reservation and project directories

The bot supplies one durable ExecutionGate under the OS user's shared account base
for host backends. Each account queue claims it before execution; its identity is
account state directory plus durable job ID. The short heartbeat mutex protects
only reservation updates. Process death does not expire the reservation itself.
Only a confirmed terminal result or original-job reconciliation releases it. A
completed job left behind by a crash is cleaned on that account's queue startup.
An unbound pending/cancelled job is also safe to release: the queue persists
thread binding before submitting any turn.
Missing or cancelled records with uncertain execution require operator diagnosis;
never force-clear a reservation merely because its process has exited.

This is conservative host-wide foreground serialization, not a sandbox or a
project-level file lock. External CLI tasks and detached background commands are
outside its coverage. All participating accounts must use the same installed
version; older processes do not acquire this gate. Containers keep their existing
separate execution policy. Existing unresolved jobs must be reconciled before
rolling this change into an active installation.

A newly created project can store a canonical workspace before its first thread
connection. Existing threads retain their old directory. The same workspace is
used for RPC creation, thread start/resume, Claude workspace guidance and output
packaging. Project labels and directory authorization remain distinct.
