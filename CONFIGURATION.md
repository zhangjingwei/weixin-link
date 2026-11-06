# 通用代码与个人配置

源码中仅保留通用规则和脱敏示例，不预设家庭主机、微信账号、天气地点或备份目标。示例不自动启用；登录凭据、会话、附件、日志与备份仍保存在用户私有目录。

## 远程主机与项目

复制 agent-workspace/remote-hosts.example.json 为工作目录的 remote-hosts.json，填写实际 SSH 别名、Codex 绝对路径与允许的项目根目录。缺省不注册任何主机；格式错误会明确拒绝加载。可用 WECHAT_REMOTE_HOSTS 指向外部 JSON。不要将凭据放入主机 JSON。

复制 targets.example.json 为工作目录的 targets.json，填写已核实的主机和项目别名。可用 WECHAT_TARGETS_FILE 指向外部文件。候选识别不构成执行授权。

SSH 使用 WECHAT_SSH_CONFIG 指定的文件，默认 ~/.ssh/wechat_hosts_config。examples/ssh-config.example 展示严格密钥校验；需自行验证主机密钥，不自动接受未知密钥。

源码内 agent-workspace/AGENTS.md 是通用模板；部署时复制到工作目录，再在该私有副本中填写助手名称、地点和个人要求。已有工作目录的 AGENTS.md 不覆盖。远程连接位于 src/remote/，共享协议位于 src/base/codex/，任务协调位于 src/core/remote-tasks/；不再复制实现到工作目录。新入口为 node src/remote/remote-codex.mjs，默认使用安装配置中的工作目录；WECHAT_REMOTE_WORKSPACE 可指定实际工作目录。旧工作目录如需保留 remote-*.mjs 调用方式，仅复制 agent-workspace/ 中的兼容入口与 remote-loader.mjs，并设置 WECHAT_BOT_ROOT 为机器人源码的绝对路径。

## 可选集成

- HA：复制 examples/ha.example.json 到 ~/.config/wechat-assistant/ha.json，替换 URL 与令牌，权限设为 0600；保持只读。
- 加密备份（Linux）：复制 examples/backup.example.json 到 ~/.config/wechat-assistant/backup.json；WECHAT_BACKUP_CONFIG 可覆盖位置。目标必须显式配置；公钥及远端私钥仍按原备份协议单独准备。工作目录从 installation.json 读取，源码目录自动推导。没有配置不连接默认 NAS。
- 微信账号授权：仍在账号私有 stateDir 中配置，不能放入示例或源码。
- 安装目录和 Codex 路径：沿用用户私有 installation.json，通过安装器生成；服务由安装器按真实路径生成。

## 迁移与验证

remote-hosts.json、targets.json、*.local.json、*.local.md 和 .private/ 不进入 Git。不要用 git add -f 强行加入私人配置。树莓派现有运行目录未改动。

本次准备前的个人主机清单和工作说明在 Mac mini 的 .private/original-config/ 保留，不进入提交。工作目录内已有的 AGENTS.md 应作为部署配置保留。

远程验收脚本需显式传入 HOST 和绝对测试项目目录；运行会执行真实任务，只对专用测试项目使用。Podman 验收仍要求显式准备 pilot 测试容器。

本次拆分只修改当前源码树，旧 Git 提交仍包含历史个人信息。公开发布前需另行审计并清理历史，或建立不携带旧历史的发布仓库；本次不重写历史。

## SSH、HA 与账号凭据的发布边界

实际 SSH 配置/私钥在用户的 ~/.ssh；HA URL/令牌在 ~/.config/wechat-assistant/ha.json；微信凭据、授权名单和账号身份在 ~/.local/share/wechat-ping-bot（其他账号位于 accounts/<id>）。这些目录属于运行环境，不复制到源码或发布目录，也不移动或删除正在使用的凭据。

源码仅保留 *.example.json 和 SSH 示例。私钥、公钥 PEM、HA 实际配置、账号凭据、授权名单、状态数据库及本地配置均被显式忽略。git archive 还使用 .gitattributes 排除私有目录。不要直接压缩整个工作目录，因为它可能含 .private/ 迁移备份。

提交和发布前运行 npm run check:release，检查暂存区的真实 Git 内容；即使 git add -f 强行加入敏感文件，检查仍会拒绝。CI 在安装依赖前运行同一检查。该检查基于文件名和常见密钥格式，不能保证发现所有未知格式的秘密，发布前仍需人工审查。

本轮扫描可达 Git 历史 247 个 blob，未发现 SSH 私钥标记、常见提供商 token、JWT 或实际 HA/账号配置文件；字符串候选经检查为合成测试数据。此结果不代表历史已脱敏：旧提交仍包含个人主机与路径，公开前需另行处理历史。账号和密钥始终由部署者在私有目录独立准备，不随源码继承。
