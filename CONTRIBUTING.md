# 贡献指南

欢迎通过 Issue 报告问题，或通过 Pull Request / Merge Request 提交改进。项目处于预览阶段，尚无稳定版本兼容承诺。涉及模块边界时先看[架构说明](docs/architecture/README.md)；具体实现沿用附近代码的风格和状态来源。

## 开发环境

使用 Node.js 24 或受支持的更新版本，在隔离的开发目录运行 `npm ci`。微信 SDK 使用锁定的 npm 版本；SDK 行为变更应先在独立仓库测试、发布，再更新本仓库的依赖、锁文件和协议测试。不要修改 `node_modules` 作为源码变更。

测试使用模拟数据与专用目录。真实登录、远程任务、HA 查询、微信发送和服务操作仅在明确授权的专用测试环境执行；停止任务前核对账号、会话和任务归属。

## 按改动范围验证

先运行受影响领域的测试，例如 `node --test tests/management/*.test.mjs`。新增失败路径时验证实际行为，尤其是重复消息、未知投递、取消、重启和账号隔离。修复本次改动引起的失败后重跑相关测试。

| 改动范围 | 增加的检查 |
| --- | --- |
| Codex 管理协议 | `npm run check:codex-contract` |
| Codex 媒体输入协议 | `npm run check:codex-input` |
| 远程适配器 | `node --test tests/remote/*.test.mjs` |
| 安装、升级或服务入口 | `node --test tests/setup/platform-service.test.mjs tests/setup/platform-smoke.test.mjs`，并运行相关 `tests/setup/` 测试 |
| 发布文件检查器 | `node --test tests/tools/release-check.test.mjs` |
| 准备提交或发布 | 暂存拟提交内容后运行 `npm run check:release`；准备发布时再运行 `npm test` 和上述适用检查 |

`check:release` 检查 Git 暂存区，而非仅检查工作副本；它不能替代人工审查。跨平台 CI 命令见 [platform.yml](.github/workflows/platform.yml)。报告实际运行的检查、失败项和环境；静态测试通过不等于真实微信收发或跨平台人工验收。

## 提交要求

- 说明问题、行为变化和验证结果，保持改动范围清晰；协议或状态格式变化应说明兼容与恢复语义。
- 不提交密钥、账号标识、聊天记录、附件、日志、数据库或本机部署配置。示例使用虚构数据，并人工检查暂存区。
- 不覆盖用户配置；涉及账号隔离、授权、停止和恢复边界时说明影响。
- 引入依赖或复制第三方代码时记录来源、许可和修改，并更新 `THIRD_PARTY_NOTICES.md`；不得将第三方代码直接改标为 MIT。

自有贡献按本项目 MIT 许可证提供。第三方内容保留其适用许可；项目未设置额外 CLA 流程。安全问题不要在公开 Issue 中披露可利用细节或真实凭据，参见 [SECURITY.md](SECURITY.md)。

## 在专用安装中试用

以下命令会操作本机安装并可能重启该安装下正在运行的账号服务，仅用于已授权的专用测试安装。macOS 和 Linux 的 `./upgrade-local.sh` 默认将当前工作目录（包括未被 Git 忽略的新文件）制作成临时快照；`--staged` 仅使用暂存内容，`--check` 仅预览，`--details` 显示改动明细和快照编号。脚本使用临时 Git 索引，不改变原暂存选择。

```sh
./upgrade-local.sh --check
./upgrade-local.sh --staged --check
```

确认快照和目标安装后，按所选来源运行 `./upgrade-local.sh` 或 `./upgrade-local.sh --staged`。可用 `WEIXIN_LINK_DIR` 指定标准安装路径。升级器会检查任务是否空闲、切换后服务是否就绪；失败时按现有恢复流程处理。若目标存在未完成安装标记，脚本可能接续安装向导和微信登录，因此执行前须确认测试环境与授权。

直接使用 npm 入口时，先用 `git add -p` 或 `git add <路径>` 选择内容，再用 `git diff --cached` 核对。该入口始终打包暂存区：

```sh
npm run upgrade:local -- --check
npm run upgrade:local
```

无需为本地试用提交、合并、打标签或创建 Release。再次试用前重新暂存最新修改。本地快照不带正式发布标记；试用结束后可通过标准安装入口切回公开稳定版。

## 正式版本发布

发布前同步 `package.json` 与 `package-lock.json` 版本，更新 `CHANGELOG.md`，完成适用检查，并核对暂存区与拟发布提交。标签采用 `vX.Y.Z`，须指向已审查提交且与包版本一致；不要移动已发布标签。GitHub Release 应为非草稿、非预发布，并将预期稳定版设为 latest。推送主干不等于发布；创建标签和 Release 需要本次发布授权。

Release 正文和 `CHANGELOG.md` 对应版本均维护 3～5 条用户可感知的顶层要点。新版本提醒摘录 Release 正文前 5 条；升级完成通知摘录本机已安装标签对应的 `CHANGELOG.md` 条目，不借用其他版本内容。每条最多显示 140 字符，完整内容由该版本 Release 链接提供；无要点时明确提示缺少摘要。安装器默认下载 latest 正式版，没有 Release 时失败，不回退主干。
