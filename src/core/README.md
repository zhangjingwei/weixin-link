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
