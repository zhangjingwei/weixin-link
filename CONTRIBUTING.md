# 贡献指南

欢迎通过 Issue 描述问题或通过 Pull Request / Merge Request 提交改进。项目处于预览阶段，尚无稳定版本兼容承诺。

## 开发与验证

使用 Node.js 24 或受支持的更新版本。在隔离的开发目录运行 npm ci；postinstall 会应用已审查的 SDK 补丁，不要直接使用生产账号目录进行开发。

提交前检查：

```sh
npm run check:release
node --test tests/tools/release-check.test.mjs
node --test tests/setup/platform-service.test.mjs tests/setup/platform-smoke.test.mjs
npm test
```

涉及远程适配器时增加 `node --test tests/remote/*.test.mjs`。报告实际执行的检查、失败项及环境；不得将静态测试通过描述为跨平台或真实微信验收通过。

真实登录、远程任务、HA 查询、消息发送和服务操作只在有明确授权的专用测试环境执行。停止任务必须核对归属，不得终止其他会话或共享服务。

## 提交要求

- 说明具体问题、修改后的行为和验证结果；尽量保持每次改动范围清晰。
- 不提交真实密钥、账号标识、聊天记录、附件、日志、数据库或本地部署配置；示例使用虚构数据。
- 提交前暂存拟发布内容，再执行 npm run check:release；该检查读取暂存区，而不是只检查工作副本。
- 不在修复中覆盖现有用户配置，不改变账号隔离、执行授权、停止与恢复边界而不说明影响。
- 引入依赖或复制第三方代码时说明来源、许可和修改，并更新 THIRD_PARTY_NOTICES.md；不能将第三方代码直接改标为 MIT。

提交自有贡献即表示同意按本项目 MIT 许可证提供该贡献。第三方内容必须保留其适用许可；本项目未设置额外 CLA 流程。

安全问题不要在公开 Issue 中披露可利用细节或真实凭据，参见 SECURITY.md。

## 正式版本发布

发布前同步 `package.json` 与 `package-lock.json` 版本、记录变更并完成上述检查。
发布标签采用 `vX.Y.Z`，标签必须指向已审查的提交，且与包版本一致；在 GitHub
创建非草稿、非预发布 Release，并将预期的稳定版设为 latest。不要移动已发布标签。
推送主干不等于发布版本；创建标签和 Release 需要本次发布授权。
安装器默认下载 latest 正式版本；没有 Release 时明确失败，不回退主干。
