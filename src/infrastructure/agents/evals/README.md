# 技能验证

`npm run eval:skills` 验证 `discussing-designs` 和 `delivering-results` 的模型回复。用例在 [cases.mjs](cases.mjs)，检查标题、关键内容、问题数量和共识长度。`discussion-advice` 和 `delivery-text-result` 检查自动选用技能；其他正例显式加载技能，检查技能行为。各智能体共用场景和评分规则。每个场景使用独立的临时会话；同一场景的多轮消息共享上下文。验证器不启动微信服务，也不操作项目源码或远程任务。

## 运行模型评测

先准备一个**单独的** Codex 配置目录并登录。不要使用日常的 `~/.codex`：

```sh
mkdir -p /tmp/zerolink-eval-codex
CODEX_HOME=/tmp/zerolink-eval-codex codex login
npm run eval:skills -- --codex-home /tmp/zerolink-eval-codex
```

可用 `--list` 查看场景 ID，用 `--case discussion-consensus` 只跑一个场景，用 `--model <模型名>` 指定模型，或加 `--show-replies` 查看模型原文。实际评测会调用模型，可能产生费用；不会调用微信 SDK。评测会话使用只读沙箱、临时工作目录，结束后删除。

## 离线检查判定规则

把各轮模型最终回复存为 JSON，其中键为场景 ID，值为回复数组，然后运行：

```sh
npm run eval:skills -- --responses /path/to/responses.json
```

单场景文件示例：`{"discussion-advice":["💡 Zero · 方案讨论\n先用表格。"]}`。

可以配合 `--case` 只检查一个场景。失败时命令返回非零状态，并列出未满足的条件。离线模式只检查提供的文本，不证明技能已被模型正确选用。

这些规则只覆盖可观察的回复格式和内容。模型评测结果会随模型版本、上下文及采样而变化；失败时应阅读实际回复，再判断是技能指令、用例还是判定规则需要调整。


## Claude Code、WorkBuddy、Doubao、Grok

为每个智能体准备单独的、已登录的测试用户目录。测试程序把它作为 CLI 的 HOME 和 USERPROFILE，并在临时工作目录中连接实际适配器。先运行原生握手和会话身份检查，再运行文本评测。将下面的 `claude` 换成 `workbuddy`、`doubao` 或 `grok` 可检查对应执行器。

```sh
npm run eval:skills -- --agent claude --agent-home /path/to/isolated-test-home --native-only
npm run eval:skills -- --agent claude --agent-home /path/to/isolated-test-home
```

显式技能用例在这些适配器上将指定 SKILL.md 作为输入，只验证按技能要求作答。自动用例只发送用户请求，不注入技能内容。Codex 另有原生技能发现检查（`node src/tools/verify-management-native.mjs`）。模拟协议测试可用 `node --test "tests/agents/*.test.mjs"` 运行；缺少兼容 CLI 或隔离登录时，应将真实执行标为未验证。
