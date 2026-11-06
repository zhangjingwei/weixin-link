# 配置与安装维护

日常配置直接在微信说明需求，例如“帮我配置远程主机”“检查家庭设备连接”或“创建第二个机器人账号”。智能体查询现状、校验参数和连接，再调用管理命令处理，无需用户使用 IDE、nano 或手工编辑运行 JSON。

自然语言配置需要模型可用；安装向导、登录和中文诊断入口由代码处理，不依赖模型。首次建立微信连接、扫码及外部账号授权由用户完成。

## 安装来源与目录

`bootstrap.sh` 和配套源码已在 `main`。仓库目前为私有，匿名访问 raw 脚本和源码包会返回 404；使用具有读取权限的 Git 环境克隆 `main`，再运行 `./install.sh` 或 `.\install.ps1`。仓库可公开读取后，README 中的一行引导命令才可匿名使用。

引导脚本支持 Linux/macOS arm64、x64，默认下载 `main`：

- `ZERO_LINK_DIR`：源码保存目录，默认 `~/.local/share/zero-link/source`。
- `ZERO_LINK_REF`：下载的分支、标签或提交，默认 `main`。
- 目标目录已存在时拒绝覆盖；脚本用于首次安装，不自动更新已有部署。

不同目录分别承担不同用途：

| 用途 | 默认位置 |
| --- | --- |
| 引导脚本下载的源码 | `~/.local/share/zero-link/source` |
| 智能体工作区 | `~/work/wechat-assistant` |
| 安装配置 | `~/.local/share/wechat-ping-bot/installation.json` |
| 默认微信账号数据 | `~/.local/share/wechat-ping-bot` |
| 其他微信账号数据 | `~/.local/share/wechat-ping-bot/accounts/<id>/` |
| HA 与备份私有配置 | `~/.config/wechat-assistant/` |

Git 手动安装的源码位置是克隆目录。工作区和 Codex 路径由安装配置确定，不随下载目录自动变化。安装器保留已有工作区 AGENTS.md 的用户内容，仅更新明确标记的程序管理区块；更新后新会话才能读取新规则。

## 微信操作

- `安装向导`：按当前步骤选择运行环境、安装、登录及验证。
- `安装状态`、`安装智能体`、`登录智能体`、`验收智能体`：独立安装维护入口。
- `运行诊断`、`服务状态`、`查看最近错误`、`导出诊断报告`：查询当前账号诊断和服务状态，不调用模型。
- 远程主机、HA、备份与多账号：用自然语言说明需求，由智能体执行下方底层接口。

微信在线只代表通道建立。向导可发起一次真实模型测试；协议检查与实际推理分别报告结果。多账号需分别扫码，不复制已有凭据或授权名单。

## 二维码维护

Linux/macOS 在安装源码目录运行 `./wechat-setup qr`，再次显示当前二维码。使用引导脚本默认目录时先运行 `cd ~/.local/share/zero-link/source`。

二维码过期且尚未建立微信通道时，由安装维护终端刷新默认账号：

```sh
PATH="$HOME/.local/share/wechat-ping-bot/tools/node/bin:$PATH" node src/wechat/account-manager.mjs refresh-qr default
```

Windows 使用安装时准备的 Node.js，从源码目录调用同一账号工具；仅安装了私有 Node 时，可执行：

```powershell
& "$HOME\.local\share\wechat-ping-bot\tools\node\node.exe" src/wechat/account-manager.mjs refresh-qr default
```

已在线账号拒绝刷新。二维码采用 90 秒保守本地展示窗口，服务端报过期或配对退出后不继续交付旧码。微信通道建立后，其他账号的创建和二维码交付可直接委托智能体完成。

## 智能体与维护者接口

以下是源码目录下的底层接口，不是用户在微信中需要记忆的英文命令。运行时需使用 Node.js 24+；Linux/macOS 若只安装了私有 Node，先将其 bin 目录加入当前命令的 PATH，或通过 `./wechat-setup` 调用配置入口。

```sh
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-check ha < /path/to/private-ha.json
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/setup/setup.mjs config-status
node src/setup/setup.mjs config-restore ha
```

类型支持 `installation`、`ha`、`backup`、`remote-hosts`。schema 返回格式；check 校验输入；set 检查连接和运行条件后原子写入并保留上一版；status 返回配置状态；restore 重新校验并恢复上一版。配置通过标准输入提供，不将令牌放入命令参数。

安装工作区不能直接迁移。存在运行实例时，安装路径配置需先停服务；远程主机有未对账任务时，删除或改变目标会被拒绝。恢复配置同样遵守这些检查。

多账号入口为 `node src/wechat/account-manager.mjs`，支持 `list`、`create`、`login`、`refresh-qr`、`qr`、`start`、`stop`、`verify`。`qr` 导出可交付文件；`stop` 等待指定账号空闲后停用，不影响其他账号。

## 远程主机与可选集成

- **远程主机**：私有工作区 `remote-hosts.json` 使用 `version: 1` 和 `hosts` 对象；每个主机包含 `platform`、`binary`、`root`、`transport`，`ssh-websocket` 另需 `port`。兼容旧版主机映射格式。用 config-schema 查看完整规则。
- **SSH**：`WECHAT_SSH_CONFIG` 指定配置文件，默认 `~/.ssh/wechat_hosts_config`。示例见 [SSH 配置模板](config-templates/ssh-config.example)，保持主机密钥校验。
- **HA**：智能体参考 [HA 模板](config-templates/ha.example.json)，通过配置接口写入 `~/.config/wechat-assistant/ha.json`；当前只读查询。
- **备份（Linux）**：智能体参考 [备份模板](config-templates/backup.example.json)，通过配置接口写入 `~/.config/wechat-assistant/backup.json`；目标、加密公钥及远端私钥独立准备。

运行时可通过 `WECHAT_REMOTE_HOSTS`、`WECHAT_BACKUP_CONFIG` 指向外部配置；配置管理接口不接管自定义路径，遇到不一致时返回 `CONFIG_CUSTOM_PATH_UNMANAGED`。远程工作区可用 `WECHAT_REMOTE_WORKSPACE` 指定。

项目定位由智能体结合请求和实际目录处理，主机注册与允许根目录只限定执行边界。远程连接入口见 [远程连接文档](src/remote/README.md)，无需向私有工作区复制执行脚本。

## 升级与验证

已有部署先核实源码、工作区和服务实际路径，再安排更新；保留账号数据、AGENTS.md、远程会话记录和 outputs，不直接覆盖运行目录。服务入口位于 src/，由安装器按真实路径生成。Windows 已有任务配置不一致时明确拒绝覆盖，需要单独核对迁移。

远程验收脚本需要指定主机和专用测试项目，会执行真实任务；登录、发送消息、服务重启和容器切换按用户授权进行。检查通过与真实收发验收分别报告，见 [贡献指南](CONTRIBUTING.md)。

## 私有数据与发布检查

SSH 私钥、HA 令牌、微信/Codex 凭据、聊天记录、附件、状态数据库和本地配置不进入源码或发布包。模板仅含脱敏示例，不自动启用集成，也不提供维护者的账号权限。

提交前暂存拟发布内容，再运行 `npm run check:release`。它检查暂存区路径和常见密钥格式，不替代人工检查、依赖审查或 Git 历史审计。不要直接压缩整个运行目录；公开发布前独立审计历史，发现凭据泄露时先撤销或轮换。
