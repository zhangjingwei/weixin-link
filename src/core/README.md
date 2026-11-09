# 旧命令兼容入口

`src/core/` 已不保存会话、任务或运行状态的实际实现。旧定时与远程任务命令路径保留薄入口，分别转发到 `src/interfaces/cli/schedule-cli.mjs` 与 `src/interfaces/cli/remote-cli.mjs`。新调用方直接引用所属层。

职责边界见 [`docs/architecture/README.md`](../../docs/architecture/README.md)。
