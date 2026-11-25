# 配置与安装维护

## 安装与目录

Linux/macOS 使用 `install.sh`，Windows x64 使用 `install.ps1`。首次安装与后续升级共用入口；默认下载最新正式 Release。开发者可通过 `WEIXIN_LINK_REF` 指定分支、标签或提交，通过 `WEIXIN_LINK_DIR` 指定源码目录。已有安装的菜单提供升级、执行器绑定说明、重新登录微信和卸载。卸载保留助手数据与工作区。

| 用途 | 默认位置 |
| --- | --- |
| 引导脚本下载的源码 | `~/.local/share/weixin-link/source` |
| 智能体工作区 | `~/work/wechat-assistant` |
| 安装配置 | `~/.local/share/wechat-ping-bot/installation.json` |
| 微信助手数据 | `~/.local/share/wechat-ping-bot` |
| HA 私有配置 | `~/.config/wechat-assistant/` |

Git 手动安装的源码位于克隆目录。工作区由安装配置确定；Codex CLI 从项目依赖目录启动。安装器保留工作区已有 `AGENTS.md` 的人工内容，只更新程序管理区块；新会话才能读取更新后的规则。

Linux/macOS 安装命令：

```sh
curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | sh
```

Windows PowerShell 安装命令：

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))
```

首次安装在终端完成微信登录。登录地址只在当前配对期间有效；若微信要求 PIN，在同一终端输入。重新登录时再次运行安装命令，选择“重新登录微信”。

## 模型接入

新会话首次收件时会列出本机可用的执行器。回复名称即可绑定并继续原任务。执行器沿用各自 CLI 的登录和模型配置。

Codex 订阅连接方式由 `src/infrastructure/agents/codex/subscription-transport.json` 设置，当前默认为 HTTP。本地升级试用可用 `./upgrade-local.sh --auto` 选择自动连接方式；这项选择只作用于该次本地升级快照。

## 微信操作与底层配置

微信中的一般管理需求用自然语言提出，由模型和管理工具处理。模型不可用时仍可在终端使用安装菜单和配置命令；微信的“服务状态”由代码直接处理。

在源码目录使用 Node.js 24+ 执行配置命令。配置 JSON 通过标准输入传入，避免把密钥放进命令参数：

```sh
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-check ha < /path/to/private-ha.json
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/setup/setup.mjs config-status
node src/setup/setup.mjs config-restore ha
```

`config-schema` 查看格式，`config-check` 校验输入，`config-set` 写入并保留上一版，`config-restore` 恢复上一版。核心类型为 `installation`、`remote-hosts`；可选集成的配置类型由 `node src/setup/setup.mjs integration-list` 查看。远程主机配置写入时只校验格式，使用主机时再检查连接。`installation` 的工作区不能通过此接口迁移，配置从服务下次启动生效。

## 远程主机与可选集成

- 远程主机配置位于工作区的 `remote-hosts.json`；格式由 `config-schema remote-hosts` 给出。SSH 配置默认位于 `~/.ssh/wechat_hosts_config`，可通过 `WECHAT_SSH_CONFIG` 指定。参见[远程连接文档](src/infrastructure/remote/README.md)和[SSH 配置模板](config-templates/ssh-config.example)。
- HA 配置位于 `~/.config/wechat-assistant/ha.json`，写入后还需显式启用 `home-assistant` 集成。参见[HA 模板](config-templates/ha.example.json)和[集成说明](src/integrations/README.md)。

`WECHAT_REMOTE_HOSTS` 可指定自定义配置路径；配置管理接口不接管此路径。可选集成需显式启用，调用时仍会检查授权状态。

## 升级与发布

标准安装通过原安装入口升级。升级器先核对源码和服务，等待任务空闲，再切换源码并检查启动；失败时尝试回滚。若回滚无法确认，保留恢复记录与临时材料供人工核对。自定义部署使用自己的升级流程。远程验收会执行真实任务，需按[贡献指南](CONTRIBUTING.md)使用专用测试项目。

SSH 私钥、HA 令牌、微信与 Codex 凭据、聊天记录、附件、状态数据库和本地配置不得进入源码或发布包。发布前暂存拟提交内容并运行 `npm run check:release`，再人工检查暂存区与 Git 历史。
