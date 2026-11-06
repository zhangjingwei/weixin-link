# 可选集成

核心通过静态注册表提供发现、配置、启停、检查、调用和会话指引。第一批迁移 Home Assistant；备份仍沿用现有配置实现，新闻尚未迁入本注册表。

## 使用和迁移

在源码目录运行以下命令。日常使用可由智能体根据用户请求调用，不要求用户手工编辑 JSON。

```sh
node src/integrations/cli.mjs list
node src/setup/setup.mjs config-schema ha
node src/setup/setup.mjs config-set ha < /path/to/private-ha.json
node src/integrations/cli.mjs enable home-assistant default
node src/integrations/cli.mjs check home-assistant default
node src/integrations/cli.mjs call home-assistant default <<'JSON'
{"operation":"states","query":"书房"}
JSON
node src/integrations/cli.mjs disable home-assistant default
```

`list` / `status` 接受一个可选账号；`enable` / `disable` / `check` / `call` 接受集成 ID 和可选账号。未指定账号时取 `WECHAT_ACCOUNT`，再回退 `default`。安装入口同时支持 `integration-list/status/enable/disable/check/call`，参数与上述入口一致。

- 保留 `config-schema/check/set/restore/status ha` 和 `~/.config/wechat-assistant/ha.json`，兼容不带 version 的旧配置；无须复制已有令牌。配置不会自动启用。
- 每个账号私有状态目录中的 `integrations.json` 记录启用状态。缺失时全部禁用；损坏时拒绝调用并省略集成指引。启用前校验配置和连接，失败不会写入启用状态；禁用不要求连接正常。
- 首版所有已授权账号使用同一份宿主 HA 配置。每个账号必须单独启用；尚不支持多个 HA 实例或账号专属凭据。
- 旧 `node src/integrations/home-assistant/ha-read.mjs states ...` / `history ...` 入口保留，但现在也检查当前账号的启用状态。迁移部署后先显式启用，再使用旧入口。
- 启用/禁用状态每次调用重读，禁用阻止后续调用；已经发出的请求可能完成。启用后的指引在下一次新建或重新连接会话时生效。已有会话可能保留旧指引，但调用仍会检查最新状态。
- 指引按本地账号加载到会话，不向共享 `AGENTS.md` 写入 HA 说明或任何凭据；远程/容器底座暂不加载宿主集成。
- `status` 只检查本地配置，不探测网络；禁用的集成不读取凭据。`check` 主动检查连接。单个集成配置错误或连接失败不会阻止普通会话。

迁移已有私人部署时，先备份账号状态和配置，显式启用需要的账号，并清理个人 `AGENTS.md` 中手写的旧 HA 路径和重复说明。程序仅维护其标记区块，不自动删除个人文字。验证完成后再切换服务源码路径；本次功能改动不执行生产部署。

## 扩展契约

新增同类集成时，添加模块并在 `registry.mjs` 注册。模块导出：

| 字段 | 作用 |
| --- | --- |
| manifest | 唯一 id、版本、名称、唯一 configKind、能力列表和只读声明 |
| schema | 供现有配置验证器消费的配置 schema |
| configPath(context) | 源码外的私有配置位置 |
| health(config) | 有界连接检查，不返回凭据 |
| invoke(config, request) | 校验操作及参数后调用服务 |
| guidanceUrl | 按启用状态加载的模块使用说明 |

描述模块不导入 setup/runtime，避免配置 schema 发现阶段出现循环依赖。网络客户端按需加载。不要把配置路径、服务探测或指引再写回微信收发和会话管理代码。schema 使用 `config-schema.mjs` 已实现的验证子集；扩展字段类型需同时补充通用校验与测试。

Home Assistant 仅公开 states/history；REST 使用固定 GET 路径，禁止重定向；WebSocket 只用于认证和三个固定的注册表读取命令。请求有超时，服务错误对外转为固定错误码。缺少房间元数据时保留状态结果并返回警告。

启用列表是受信任宿主进程的功能授权检查，不是操作系统安全边界。同一 OS 用户下具备任意 shell/文件访问权限的智能体仍可读取配置或修改环境变量；需要不可信多租户隔离时，应使用独立 OS 用户或容器及独立凭据。HA 只读由本集成的操作白名单约束，不代表 HA 长期令牌本身只有读取权限。

## 验证

```sh
node --test tests/integrations/home-assistant.test.mjs tests/setup/config-manager.test.mjs
```

测试使用临时目录和模拟 HA 响应，不读取生产凭据、不发送微信消息、不操作设备。
