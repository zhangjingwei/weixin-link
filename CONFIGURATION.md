# 通用代码与个人配置

源码中仅保留通用规则和脱敏示例，不预设家庭主机、微信账号、天气地点或备份目标。示例不自动启用；登录凭据、会话、附件、日志与备份仍保存在用户私有目录。

## 远程主机与项目

启用远程连接时，由智能体通过配置接口在私有工作目录管理 remote-hosts.json：每个键是实际 SSH 别名，配置包含 platform、binary、root、transport，ssh-websocket 另需 port。填写真实系统类型、Codex 绝对路径和允许访问的项目根目录。缺省不注册任何主机；格式错误会明确拒绝加载。可用 WECHAT_REMOTE_HOSTS 指向外部 JSON。不要将凭据放入主机 JSON。

项目定位由智能体底座自行管理。接入层不读取项目别名文件，也不向原始请求注入项目/主机候选。远程连接配置的主机注册和允许根目录属于执行边界，不用于推断用户要操作哪个项目。

SSH 使用 WECHAT_SSH_CONFIG 指定的文件，默认 ~/.ssh/wechat_hosts_config。config-templates/ssh-config.example 展示严格密钥校验；需自行验证主机密钥，不自动接受未知密钥。

安装器创建或复用实际工作目录；缺少 AGENTS.md 时生成规则，已有文件保留用户内容，仅更新明确标记的程序管理区块。用户可在该私有文件中补充工作要求，仓库不提供独立工作目录模板。远程连接位于 src/remote/，共享协议位于 src/base/codex/，任务协调位于 src/core/remote-tasks/。统一使用 node src/remote/remote-codex.mjs，默认读取安装配置中的工作目录；WECHAT_REMOTE_WORKSPACE 可指定实际工作目录。无需向工作目录复制执行脚本。

## 可选集成

- HA：由智能体参考 config-templates/ha.example.json，通过配置接口校验并写入 ~/.config/wechat-assistant/ha.json；保持只读访问。
- 加密备份（Linux）：由智能体参考 config-templates/backup.example.json，通过配置接口校验并写入 ~/.config/wechat-assistant/backup.json；WECHAT_BACKUP_CONFIG 可覆盖位置。目标必须显式配置；公钥及远端私钥仍按原备份协议单独准备。工作目录从 installation.json 读取，源码目录自动推导。没有配置不连接默认 NAS。
- 微信账号授权：仍在账号私有 stateDir 中配置，不能放入示例或源码。
- 安装目录和 Codex 路径：沿用用户私有 installation.json，通过安装器生成；服务由安装器按真实路径生成。

## 迁移与验证

remote-hosts.json、*.local.json、*.local.md 和 .private/ 不进入 Git。不要用 git add -f 强行加入私人配置。树莓派现有运行目录未改动。

本次准备前的个人主机清单和工作说明在 Mac mini 的 .private/original-config/ 保留，不进入提交。工作目录内已有的 AGENTS.md 应作为部署配置保留。

远程验收脚本需显式传入 HOST 和绝对测试项目目录；运行会执行真实任务，只对专用测试项目使用。Podman 验收仍要求显式准备 pilot 测试容器。

本次拆分只修改当前源码树，旧 Git 提交仍包含历史个人信息。公开发布前需另行审计并清理历史，或建立不携带旧历史的发布仓库；本次不重写历史。

## SSH、HA 与账号凭据的发布边界

实际 SSH 配置/私钥在用户的 ~/.ssh；HA URL/令牌在 ~/.config/wechat-assistant/ha.json；微信凭据、授权名单和账号身份在 ~/.local/share/wechat-ping-bot（其他账号位于 accounts/<id>）。这些目录属于运行环境，不复制到源码或发布目录，也不移动或删除正在使用的凭据。

源码仅保留 *.example.json 和 SSH 示例。私钥、公钥 PEM、HA 实际配置、账号凭据、授权名单、状态数据库及本地配置均被显式忽略。git archive 还使用 .gitattributes 排除私有目录。不要直接压缩整个工作目录，因为它可能含 .private/ 迁移备份。

提交和发布前运行 npm run check:release，检查暂存区的真实 Git 内容；即使 git add -f 强行加入敏感文件，检查仍会拒绝。CI 在安装依赖前运行同一检查。该检查基于文件名和常见密钥格式，不能保证发现所有未知格式的秘密，发布前仍需人工审查。

本轮扫描可达 Git 历史 247 个 blob，未发现 SSH 私钥标记、常见提供商 token、JWT 或实际 HA/账号配置文件；字符串候选经检查为合成测试数据。此结果不代表历史已脱敏：旧提交仍包含个人主机与路径，公开前需另行处理历史。账号和密钥始终由部署者在私有目录独立准备，不随源码继承。

## 智能体配置接口

日常使用时，在微信直接说明“帮我配置远程主机”“检查家庭设备连接”或“创建第二个机器人账号”。智能体负责查询、校验与执行，用户无需登录服务器使用 IDE、nano 或手工修改 JSON。首次消息通道的安装、扫码和外部账号授权仍按安装向导完成。

下列命令是供智能体和维护者调用的底层接口，不是微信中需要记忆的聊天命令。在源码目录执行：

```sh
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-check ha < /path/to/private-ha.json
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/setup/setup.mjs config-status
node src/setup/setup.mjs config-restore ha
```

类型支持 installation、ha、backup、remote-hosts。schema 返回格式，check 校验输入，set 在连接和运行条件校验后原子写入，status 只返回配置就绪状态，restore 校验并恢复上一版。实际 JSON 通过标准输入提供，不将令牌放进命令参数。安装路径迁移与活动远程任务的主机切换仍受现有保护约束。

多账号入口为 node src/wechat/account-manager.mjs，支持 list、create、login、refresh-qr、qr、start、stop、verify。智能体按用户授权执行；二维码通过 qr 导出为可交付文件，扫码及设备授权由用户完成。
