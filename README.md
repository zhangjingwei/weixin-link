# 微信 → Codex

个人配置与源码边界见 [CONFIGURATION.md](CONFIGURATION.md)。当前分支尚未清理历史中的私人信息，不能直接作为公开仓库发布。

首次安装入口：`./install.sh`；后续优先在微信发送“安装状态”“安装Codex”“登录Codex”“验收Codex”。不需要预先接入模型。完整步骤见文末“首次安装（当前入口）”；早期变更记录不作为新机器安装指南。

微信消息通过本地主机上的 Codex app-server 进入持久对话。搜索、天气、SSH、项目选择和远程 Codex 由智能体完成，目标别名规则只提供候选，不直接执行；模型与工具循环仍由官方 Codex 负责。


## 跨平台适配（2026-11-06）

先增加 macOS（arm64/x64）安装与 launchd 用户后台服务，再增加 Windows x64 安装与当前用户任务计划程序。Linux arm64/x64 的 systemd 路径保留。代码适配和 Linux 回归不等于真机验收；本次 Mac SSH 超时、Windows 网络不可达，因此尚未完成这两个系统的实际安装、扫码、收发和停止验收。

- Linux/macOS：在源码目录运行 `./install.sh`。自动校验并准备 Node.js 24、安装依赖、准备服务并启动独立配对；Mac 需要已登录的图形用户会话。没有 Homebrew 分发包。
- Windows x64：在源码目录的 PowerShell 中运行 `.\install.ps1`。需要系统允许运行本地 PowerShell 脚本，安装器不修改系统执行策略；准备 Node.js 24、账户私有目录 ACL、依赖和当前用户登录启动任务。使用交互式用户身份，不要求管理员，不保存 Windows 密码。当前不支持 Windows ARM64。
- 后续三个系统统一使用 `node setup.mjs doctor`、`node account-manager.mjs list` 以及账号管理命令。后台服务在用户登录时启动；Mac/Windows 不保证用户注销后继续工作。
- 独立账号首次启动时分别生成 launchd 任务/Windows 计划任务；配对有十分钟本地上限。账号归属和已有凭据隔离规则不变。控制端使用 Unix socket 或带私有令牌的 Windows 命名管道。
- FFmpeg 按系统和架构选择。图片/PDF 使用现有原生依赖；Office 文本解析额外需要 Python 3（Mac/Linux 命令 `python3`，Windows 命令 `python`），缺少时保留原件并明确解析失败。
- Podman 隔离容器、既有 systemd 新闻定时器、NAS 备份仍是 Linux 专用功能，本轮不将其宣称为三平台已验收功能。新闻手动生成还依赖 Python、浏览器和中文字体，应另作专项验收。

跨平台核心检查：`node --test tests/setup/platform-service.test.mjs tests/setup/platform-smoke.test.mjs`，含真实文件锁竞争、SQLite WAL、控制连接、图像和 FFmpeg 加载。`.github/workflows/platform.yml` 配置了三系统检查，但本地尚未运行 Mac/Windows CI。完整上线仍需在每个目标机上检查安装诊断、用户后台任务、独立扫码、文字/图片/文件收发、/stop 和服务停止。

## 文件

- `bot.mjs`：微信登录、授权账号检查、分段收发。
- `codex-session.mjs`：官方 thread/turn 协议、恢复、去重、排队、中断、交互请求和错误反馈。
- `agent-workspace/AGENTS.md`：通用行为与安全规则；个人主机配置不随代码发布。
- `ha-read.mjs`：独立 HA 只读数据接口；由 Codex 调用，令牌不进入模型参数。
- `wechat_hosts_config`：标准 SSH 别名与密钥校验配置。
- `wechat-ping-bot.service`：用户级 systemd 服务。

## 微信命令

普通消息直接发给 Codex。首次消息创建对话，服务重启后恢复原 thread。

| 命令 | 行为 |
|---|---|
| `补充 内容` 或 `补充：内容` | 将文字加入当前执行轮次，接入层反馈提交结果，不排队 |
| `/status` | 当前对话、任务和队列状态 |
| `/stop` | 中断本轮任务，清空等待消息 |
| `/exit` | 停止当前任务并关闭连接，保留聊天记录 |
| `/new` 或 `/reset` | 新建对话 |
| `/result` | 重看最近回复 |
| `/balance` | 查询 DeepSeek API 实时余额 |
| `/help` | 查看帮助 |

补充仅发送给当前选中会话的活动轮次；没有活动任务、仍在启动、正在停止或已收到最终回复时明确提示未提交。回执只代表官方接口接收，不保证操作已执行。提交前保存记录，断线或超时不自动重发，不转投下一任务。普通消息及附件继续沿用原有队列。

停止单台远程 Codex 可直接说明主机和任务，由主智能体执行并核实。`/stop`、`/exit` 会封锁本对话的新提交，调用官方中断和后台终端终止接口，核验本对话委托的远程任务是否停止；失败时明确提示未确认。

## 树莓派运行位置

- 程序：`~/wechat-ping-bot/bot.mjs`。
- Codex 工作目录：`~/work/wechat-assistant`。
- 会话元数据与微信登录：`~/.local/share/wechat-ping-bot`。
- HA 凭据：`~/.config/wechat-assistant/ha.json`，文件权限 0600。
- SSH 配置：`~/.ssh/wechat_hosts_config`。
- Codex：`~/.local/bin/codex`，使用已登录账号和内置实时搜索。

运行账户、后端及访问权限以本地安装配置为准。微信只接受已配置的账号。HA 当前仅授权查询。

```sh
systemctl --user status wechat-ping-bot.service
systemctl --user restart wechat-ping-bot.service
journalctl --user -u wechat-ping-bot.service -f
node --test ~/wechat-ping-bot/codex-session.test.mjs
```

旧程序在树莓派 `~/wechat-ping-bot/backups` 中保留。原远程 thread 映射仍在状态目录的 `codex-sessions.json`，新主会话元数据为 `assistant-sessions.json`。

## 附件接入

支持微信 SDK 提供的图片、文件（含 PDF/Office）、视频和语音附件；授权账号校验先于下载。附件保存到 `~/.local/share/wechat-ping-bot/attachments/<账号哈希>/<随机目录>`，目录 0700、文件 0600，原始文件名不会作为路径使用。单消息最多 10 个附件，总计 50MiB；加密 CDN 流下载有大小限制和 60 秒超时。每账号附件存储接近 1GiB 或磁盘可用不足 512MiB 时停止接收。历史附件不自动删除，避免破坏对话引用，需按需清理。

PNG/JPEG/GIF/WebP 根据文件头识别，作为 `localImage` 送入 Codex；其他文件以附件清单和绝对路径传入，保留原件。失败项单独报告，不静默丢弃。PDF 可用下面的工具提取文字并渲染页面；视频可抽帧，不能视为完整音视频理解。Office 等格式已可接收，是否可解析取决于可用的格式工具。语音保存原文件及 SDK 提供的转写，没有转写时不保证识别音频。

```sh
node ~/wechat-ping-bot/media-tools.mjs pdf INPUT OUTPUT_DIR [起始页]
node ~/wechat-ping-bot/media-tools.mjs video INPUT OUTPUT_DIR [起始秒数]
node --test ~/wechat-ping-bot/codex-session.test.mjs ~/wechat-ping-bot/media-input.test.mjs
```

PDF 每次最多 5 页、长边最多 1600 像素；视频每次最多采样 60 秒内的 6 帧（间隔 10 秒），不处理音轨。视频工具使用项目目录中的 ARM64 FFmpeg，不安装系统软件。PDF 工具使用 pdfjs-dist 和 @napi-rs/canvas。

附件等待合并：收到附件即开始下载，8秒内的后续文字或附件并入同一请求，每次新消息重置计时；发送“开始”立即提交。只有附件时先询问用途，保留关联30分钟等待文字说明。控制命令不合并，/stop、/exit、/new、/reset 清除待合并附件。等待状态保存在内存，服务重启不保留未提交请求，原文件仍保存在附件目录。

### 进度消息顺序修正（2026-10-18）

微信仅转发 Codex 的实际 commentary 和最终结果，不再根据工具启动事件生成“Codex 正在执行命令”等笼统提示。已完成轮次、旧 turnId 和最终答案后的迟到 item 通知被忽略；等待发送的旧进度在最终答案到达后丢弃。保留工具元数据供审批审查，不向聊天公开原始命令。

验证：`node --test codex-session.test.mjs attachment-batch.test.mjs media-input.test.mjs`，包含迟到事件、跨轮事件和发送队列回归。

### 结构化诊断与故障排查（2026-10-18）

- 私有JSONL日志：`~/.local/share/wechat-ping-bot/logs/events.jsonl`。每份2MiB，保留5份轮转备份，总计约12MiB；目录700、文件600。写入队列最多1000条，过载丢弃数和写盘失败可观测，日志故障不阻塞消息。
- 覆盖消息接收/去重、任务排队/开始/结束、工具类型、RPC请求/响应/超时/退出、附件下载与组批、微信分段发送及失败阶段、启动/停止。用trace/thread/turn关联；账号和微信消息ID记录摘要。
- 不记录聊天正文、附件名称/内容/路径、原始命令、URL、密码/令牌、完整环境或原始异常文本。错误仅保留受限类型/代码。`send_accepted`表示微信API接受，并不证明对方已读。
- 汇总：`node diagnostics.mjs`；独立测试日志：`node diagnostics.mjs --integration`。服务状态：`systemctl --user status wechat-ping-bot.service`。收到发送失败时，最终结果仍保存在会话中，可用`/result`重新获取；会话状态落盘失败会明确提示。
- 同时修正最终回复发送期间新任务提前启动、任务等待器先于最终回复发送结束、定时附件异常无记录，以及附件上限按消息而非实际文件计数的问题。
- 验证：`node --test diagnostic-log.test.mjs codex-session.test.mjs attachment-batch.test.mjs media-input.test.mjs`（17项）；`node bot.mjs --test-codex`通过真实独立Codex连接验证，不发送微信测试消息，不影响已有会话。

微信SDK的原始告警也经自定义logger分类，避免错误文本包含请求URL/令牌。重启后自检结果保存在私有logs/activation-check.json，只包含服务与登录状态。

### Codex 富媒体输入标准化（2026-10-18）

按本机Codex CLI 0.163.0生成的`TurnStartParams.UserInput`核对，使用`text`、`localImage`；协议也有`localAudio`，但当前模型实际报告不支持音频内容，默认不启用。没有虚构`file`、`input_file`、`pdf`、`video`字段，也没有把Responses API的文件格式冒充app-server格式。

所有附件先私有保存，再由`media-preprocess.mjs`生成唯一输入清单，`codex-input.mjs`组装`turn/start.input`：

- 图片：按真实内容解码，JPEG/PNG/GIF/WebP等位图统一PNG，按EXIF方向旋转，长边最多2048；必要时转JPEG限制单图2MiB。最多4000万像素，只取动图第一帧并注明；损坏文件不会被标为视觉已读。
- PDF：自动提取前3页文字和页图，页图作为真正的`localImage`；记录总页数、已处理范围和未读部分。继续阅读可调用工具每批最多5页。
- 视频：自动在前60秒内最多抽3帧，第一帧必取；帧图作为`localImage`，明确不是完整观看、不分析音轨。工具允许后续按时间分批，每批最多6帧；禁止FFmpeg访问网络协议。
- 语音/音频：SILK可解码为WAV，其余常见音频规范为单声道16kHz PCM WAV，至多120秒。SILK先检查长度/时长；无默认外部ASR上传。当前模型不支持音频内容，因此只使用微信提供且明确标注来源的转写；无转写时说明“已保存、未识别”，不声称听过。未来更换为支持音频的模型并实测后，才能显式启用`localAudio`。
- DOCX/PPTX/XLSX：有界OOXML文字提取，XLSX解析共享字符串与缓存单元格值；不运行宏、不提取ZIP路径、不访问外链。仅文字，不把版式/图片标为已理解。旧DOC/XLS/PPT、普通ZIP和未知格式保留原件，明确未解析。
- TXT/MD/CSV/JSON等UTF-8文档：有界文字片段；单批提取文字预算16000字符，视觉最多10张。所有文件名、转写和提取文字都是用户数据而非系统指令；不执行附件程序。每件附件记录SHA256、处理状态及对应视觉编号。

图片与后续文字在同一组保留；下载或规范化期间收到补充文字时，旧提交作废，按最新说明重新提交；`/stop`可取消组批，已经启动的有界解码不会提交迟到结果。一个文件缺失或解析失败不丢弃其它有效附件。

核对与测试：
```
npm test
npm run check:codex-input
FONTCONFIG_FILE=/tmp/mova-fonts.conf npm run test:media-live
```
当前28项离线测试通过；真实Codex视觉识别实测通过。原生音频探测完成但模型不支持，因此不将其标为可用功能。外部语音识别服务尚未接入。

官方参考：https://developers.openai.com/codex/app-server （`turn/start` 输入项；本机导出协议用于核实版本差异）。

### 微信语音优先走转写文字

纯语音消息已有微信`voice_item.text`时，直接转换成普通文字用户输入；不上传原音频、不让Codex识别声音，也不进入附件等待说明流程。语音与图片混合时，转写作为这组附件的用户说明，保留原顺序。没有微信转写时不伪造文字，明确提示尚未配置本地/外部ASR。`voice-text.test.mjs`覆盖纯语音、混合附件及缺失/部分转写。

### 微信快捷命令（2026-10-18）

- `/status`：当前Codex会话状态、队列、待答复。状态查询仅保留 `/status`。
- `/stop`：优先处理停止请求，清除尚未提交及Codex内部排队消息；连接尚未完成时取消待启动任务；最终回复发送期间也能清空队列。
- `/models`：调用官方`model/list`分页查询当前Codex返回的可见模型、输入类型与推理档位，标注当前/默认模型。只查询，不切换模型，不发起推理。
- `/balance`：直接调用 DeepSeek 官方余额接口，返回可用状态、剩余总额、赠送余额和充值余额；同时兼容`/余额`和“API还剩多少钱”等说法。该命令不启动模型或消耗推理额度。
- `/result`：重新获取最近结果。
- `/new`、`/reset`：新建对话；执行中或最终回复发送中会说明原因，不静默丢弃当前流程。
- `/exit`：停止并断开当前会话。
- `/help`：查看上述命令。兼容`/codex status`等已有写法。

命令绕过普通消息提交队列，`/stop`不会排在长时间`turn/start`后面。独立连接就绪Promise避免`/models`与初始化并发冲突。修正`partial_answer`误触发finalReceived导致最终回复丢失。

部署辅助脚本现在等待当前进程的任务与回复发送均结束，并观察3秒安静期后才重启；十分钟仍忙则放弃本次重启，留下失败/未验证记录，不强杀任务。

模型接口依据：https://developers.openai.com/codex/app-server#list-models-modellist 。本机实测model/list返回7项，仅代表当前目录和账号环境返回的模型；未更改模型配置。

### GPT 主模型与 DeepSeek 自动降级

普通消息继续使用本机 Codex 配置的默认 GPT 海外模型。只有主模型连接、认证或任务启动明确失败时，才在同一对话中切换到 DeepSeek 备用配置。`turn/start` 已被接受后，正常的思考、排队或首个输出等待不会仅因超时就被判为 GPT 不可用。普通参数错误、工具失败和任务内容失败不会触发降级；已开始执行的主轮次也不会被盲目重放。每次新的用户消息开始前都会重新尝试 GPT 主模型，恢复后自动回到 GPT，避免一次降级永久粘住。

备用配置只通过 `WECHAT_CODEX_FALLBACK_*` 环境变量提供，不与主模型的 Codex 配置混用。切换后的最终回复会附加固定提示“⚠️ GPT 当前不可用，本次对话使用 DeepSeek 生成。”，诊断日志只记录 provider、model、阶段和结构化错误代码，不记录正文、URL 或密钥。主轮已接受但未能启动时，持久化账本先标为不确定，备用轮提交成功后再绑定备用 turn，避免崩溃恢复误重放。

快捷命令验证：42项测试通过；独立真实Codex会话中`/models`与`/status`均通过，未调用`turn/start`、未发起模型推理。部署通过实时控制接口检查 RPC、附件处理、微信发送和状态保存。

### 会话结束、取消与部署边界

- `turn/completed` 后先保存结果、完成最终回复投递，再启动排队消息。投递失败保留 `/result` 恢复入口；晚到的进展不会覆盖最终结果。
- `/stop` 直接走控制通道，清空附件批次、尚未提交的接收队列和会话队列；连接期间收到停止则取消待启动任务。`/exit` 还会关闭连接，初始化返回后不会复活已退出的会话。
- `MessageDispatch` 只负责按用户串行接收和取消代际；持久化去重统一交由 `SessionManager.acceptMessage`，覆盖附件和文字。入口已经去重后，内部调用 `handle` 不再重复传消息 ID。每个账号保存最近 100 个 ID；无 ID 消息无法去重。
- 微信转写模式保留原音频和有来源标记的文字，不额外转码；只有显式启用原生音频输入时才执行音频规范化。
- 部署使用 `activate-diagnostics.mjs` 与服务的私有 Unix socket 握手。日志不参与空闲、重启或登录判断；回执位于私有状态目录 `activation-check.json`。

### 接收侧不等待耗时任务

微信 SDK 在同一批更新内依次等待消息回调。`nonBlockingHandler` 让回调立即返回，后台处理统一捕获失败；否则后续 `/stop` 会被上一条初始化或附件处理挡住。输入提示发送不再作为提交任务的前置条件。`MessageDispatch.cancel` 同时使旧代际失效并释放新一代接收通道，旧任务返回时不能删除新通道。附件同一批次的定时触发和显式“开始”串行处理，避免重复解码和同时改写输出文件。

启动响应使用任务 trace 标识隔离：已结束或被新任务替换的启动响应不得改写当前任务编号。启动成功后的本地状态保存失败只记录并提示，不关闭正在运行的 Codex 连接。新建会话先标记旧会话失效，再异步关闭进程，防止旧初始化返回后继续提交任务。

### 统一状态和取消规则

`lifecycle.mjs` 是状态与取消规则的共同入口：

- 会话状态为 `connecting → idle → running → stopping / delivering → idle`，退出后为 `closed`；已关闭会话不能复活。`busy/connecting/finishing/exited` 是集中更新的兼容投影，不允许各模块自行写入；`exiting` 仅表示“停止后断开”的意图。
- 每个账号有独立的取消代际。消息在接收时获取令牌，附件下载、预处理、接收队列、任务队列沿用同一令牌；所有异步提交边界检查令牌是否仍有效。
- `/stop`、`/exit` 和通过校验的 `/new`、`/reset` 统一使旧代际失效。被拒绝的新建命令不会清掉待处理附件或队列。停止后新消息获取新代际，旧连接返回不能消费新消息的取消标志。
- 同一任务的重复停止共用一个中断请求；中断等待绑定原任务 trace，不能在原任务结束后误停新任务。失败允许重试。
- 支持取消的下载和预处理子进程接收 AbortSignal；不支持即时中止的操作即使稍后返回，也不能再提交旧结果。已提交给微信 API 的内容无法撤回，停止确认与最终结果仍会正常发送。


### 无日志依赖的维护与重启

`runtime-control.mjs` 提供权限为 0600 的本机 `runtime.sock`，返回当前进程 PID、启动实例标识、微信登录/轮询状态，以及实时计数；不返回账号、对话内容或凭据。

部署控制器先校验 PID，获取有期限的维护租约，再执行 drain。维护期间拒绝新任务并明确提示稍后重发，保留停止、退出、状态查询及给已有附件补充文字的入口。已进入的接收回调、排队任务、附件批次、下载/解码、发送、RPC 和状态保存均需结束；未补说明的附件会阻止重启，可用 `/stop` 取消。接收回调在进入时同步登记，避免等待异步代码才记账。

观察空闲后还必须执行 seal，服务原子复核所有计数并停止轮询，消除“检查为空闲后又进入任务”的间隙；随后 systemd 重启。控制器核对新的 PID 和实例标识，并直接检查微信已登录且正在轮询。任何控制接口缺失、PID 变化或忙碌超时都不会默认强制重启；失败会释放维护租约，控制器失联时未封存租约 120 秒后自动过期。

首次升级的旧进程没有控制接口，只有明确传入 `--bootstrap` 才允许一次迁移重启：等待 30 秒供当前回复送达，复核旧 PID 未变，再重启加载控制接口。该迁移不宣称已自动判定空闲。后续正常部署不传此参数，完全使用实时握手。


### Codex 到微信的富媒体输出

`outbound-media.mjs` 提供统一结果包、私有快照和按账号串行发送队列。`imageGeneration` 成功事件优先读取 `savedPath`，没有路径时校验图片数据；最终回答中的本机 Markdown 附件链接可交付图片、MP4及普通文件。代码示例、远程URL、纯路径、`imageView` 和普通工具日志不会触发附件上传。远程文件需先复制到本机工作区。

每组最多8个附件、总量50MB，图片规范化为最多2048边长的PNG（8MB上限），GIF仅取首帧；视频目前支持经首帧解码校验的H.264 MP4，不支持的编码明确报错，不宣称已转码或完整校验全片。文件快照按账号隔离、600权限、发送时复核大小和摘要，拒绝越界及隐藏凭据路径；Codex专用generated_images目录是唯一隐藏目录例外。原文件更改不影响已有结果快照。

最终结果包随会话原子保存；每段文字/附件在发送前记录sending，API接受后记accepted，网络异常记unknown，不自动重复发送。`/result` 是用户主动重发整组结果，包含已发送附件。停止或退出阻止尚未发送的附件；正在上传或已经提交的消息无法保证撤回。结果队列和上传均纳入实时维护检查。

`node outbound-live-check.mjs` 可显式向唯一授权账号发合成图片、1秒MP4和TXT测试，不启动第二个轮询器、不调用生成模型。私有回执在状态目录outbound-live-check.json；API接受与用户打开确认分开记录。该脚本会真实发消息，不作为npm test的一部分。

## 持久化、流式输出与候选目标

普通消息及原始附件描述在 SDK 回调返回前写入私有 `inbox.sqlite`，采用 SQLite WAL 与 synchronous=FULL，复用现有进程，无需 Redis。原始消息经原有附件合并、规范化后交给持久化执行队列；每个账号顺序消费，控制命令绕过队列。队列使用官方 clientUserMessageId、thread_id、turn_id 记录提交。重启后未提交消息继续处理，已提交消息先查询官方历史，结果不明保留为 uncertain，禁止自动再次执行。取消墓碑跨重启保留。附件下载地址失效时仍需用户重发，不执行附件程序。

`durable-jobs.mjs` 只负责持久化；`durable-intake.mjs` 复用 SessionManager 和官方会话恢复。已结束轮次的发送结果不确定时保留 /result，不自动重发整篇；本地轮次中断时按该会话委托的 remote-sessions 记录继续查询远程原任务。队列状态和正文不写入诊断日志。

`text-stream.mjs` 处理可见 assistant 文本增量，默认约 120–400 字、最多等待 2.5 秒、发送间隔至少 1.5 秒；沿用 OutputTransport。代码、链接和附件留待完整结果。最终正文仅发送未推送部分，/result 保留全文；取消后不发送未送片段。远程 `watch` 使用相同分段器，经私有 runtime.sock 回送当前拥有该任务的微信会话，按项目任务记录检查归属，保存片段发送偏移，未知发送结果不重放。

`target-hints.mjs` 从工作目录 targets.json 获取别名，只给 Codex 追加候选提示，不改变原文、不自动切换主机、不触发危险操作，不省略模型调用。项目路径须先核实再登记。

验证命令：`node --test *.test.mjs`；远程适配工作目录执行 `node --test remote-*.test.mjs`。测试覆盖崩溃后 WAL 恢复、去重、取消、提交对账、分段最终回复一致性及远程片段检查点。

## 本轮结束标识

生产入口启用 completionMarkers。收到官方 turn/completed 后，将带任务标签的结束提示合并到最终正文末尾，并随正文保存供 /result 重放；正常完成不另发消息。标识只表示执行结束，不保证附件送达，不等于远程任务全部完成。发送失败或附件送达不确定时才另外发异常提醒；等待附件及取消后的旧轮次不追加。模型正文不要手工追加重复标识。

## 阶段性输出（替代伪流式）

生产会话忽略 agentMessage/delta，只发送 item/completed 中完整的 commentary 阶段消息，以及 turn/completed 后的完整最终答复。remote watch 采用相同策略，保留发送检查点和取消核验。不按字数、定时器或标点主动刷气泡；超出微信长度限制的内容仍由发送层必要分段，表格转换、附件和本轮结束标识保持有效。text-stream.mjs 为历史辅助模块，当前生产会话与远程 watch 不再调用。

## 最近可靠性检查

DurableIntake 与 SessionManager.ask 沿用同一个取消 token，连接前后均校验，避免 /stop 后连接成功又启动旧消息。维护拒收及空消息会确认原始收件记录，不在重启时意外重放。/status 区分真正待提交消息，并显示 uncertain 数量，未确认任务不自动再次执行。

## 任务归属标识

本地结束提示包含“树莓派·微信主助手”、稳定任务短编号和原始请求摘要；不会把候选主机当成真实执行主机。remote watch 阶段消息与结束提示包含记录中的真实主机、项目目录名、远程任务短编号，结束通知使用原轮次状态并持久化去重。待主助手整理的附件不会宣称已经送达。恢复提示也标注原消息任务。

## 多微信账号

复用 bot.mjs，通过 WECHAT_ACCOUNT 选择档案。default 使用原路径和原服务；其他账号使用 accounts/<id>/ 和 wechat-ping-bot@<id>.service。登录、会话、授权、队列、附件、日志和私有控制 socket 独立；远程 watch 根据账号环境定位 socket，thread_id 仍是远程任务归属的基础。

管理：node account-manager.mjs create bot2；node account-manager.mjs login bot2；node account-manager.mjs qr bot2；node account-manager.mjs list。qr 返回工作目录 outputs/ 下的交付副本。确认扫码后自动以确认者为初始授权用户，并启动独立服务。SDK 使用内存配对，检查身份唯一性后才以0600原子写入凭据；不复制默认账号的权限或聊天记录。旧档案不允许换绑不同微信账号。

可用 start/stop 管理已配置的非默认实例，stop 使用原有 drain/seal 机制等待空闲，不把简单断开连接当作远程任务取消。如需取消任务，应先在对应微信会话发 /stop。配对验证码通过 verify 子命令提交，凭据和验证码不打印。新增账号上线需要真实扫码，模拟隔离测试不代表已验证多账号真实收发。当前用户运行权限共享，不是相互不信任用户的操作系统沙箱。

## 账号故障隔离与二维码刷新

重复登录检查逐账号容错，坏 JSON、不可读文件仅在 list 显示对应账号问题，不导致其他健康账号启动失败。独立的 account-identity.json 保留已知绑定，凭据损坏后仍可防止重复接入。不会自动删除或覆盖损坏凭据。

refresh-qr ACCOUNT 会只重启指定账号的配对流程，等待新二维码并返回版本化的交付副本。已在线机器人拒绝刷新，避免误登出。二维码必须有存活的配对进程、当前版本和匹配哈希；服务器报过期即失效，本地另用90秒展示窗口保守拒绝陈旧码，这不是服务器TTL保证。list 显示本地剩余秒数，陈旧历史 waiting_scan 标记不再作为有效二维码依据。


## Codex 原生记忆

微信接入层只配置官方原生记忆，不再维护自建记忆库、自动候选或召回注入。运行环境开启 memories 功能、生成与使用开关；会话新建和恢复成功后开启官方记忆模式。/memory 查询官方状态；auto on/off 控制当前会话，重连后默认开启。旧数据库保留，不自动删除或宣称已迁移。账号隔离依赖各自 Codex 数据目录。

## 恢复体验

`/status` 展示最新本地任务编号/摘要、执行状态和发送状态；“接口接受”不代表用户已读。`/result` 在任务执行中或执行未知时只提示当前状态，不误发上一任务结果；已终止任务重发本地保存结果，不重新执行。发送部分失败/取消/未知不算发送成功，状态持久化到账号私有会话记录。
`/recover` 仅将当前用户带官方thread_id的未确认队列任务重新交给原有官方轮次对账恢复；保留turn_id/clientUserMessageId，不调用turn/start重提。缺少关联的未知任务不自动重试。恢复完成区分成功/失败/停止，结果保存在/result，正文不盲目补发。原有附件快照在同任务恢复时保留。停止已取消任务不被/recover复活。

## 加密备份与恢复

- `wechat-assistant-backup.timer` 每天北京时间04:00（最多随机延后5分钟），关机错过后补跑。`systemctl --user start --no-block wechat-assistant-backup.service` 手动备份。
- 等所有在线机器人空闲后 drain/seal；最多等30分钟，超时失败延期，不中断任务。结束后解除封存。SQLite online backup，不复制WAL文件；每文件摘要及数据库integrity_check校验。
- 账号凭据/会话/队列/记忆、助手代码/工作区、Codex本地会话与状态、专用SSH配置和对应密钥、用户服务配置均在core.enc；附件及交付文件独立media.enc。排除node_modules、日志、运行socket、Git和旧备份。依赖可按锁文件恢复。
- 本地：`~/.local/share/wechat-assistant-backups/<UTC时间>/`；NAS：`<backup.json 中的 remoteDirectory>/<UTC时间>/`。RSA-OAEP封装随机AES-256-GCM密钥，校验加密文件NAS摘要并真实解密临时恢复；私钥只在NAS `~/.config/wechat-backup-key/private.pem`，树莓派只有公钥。不将凭据或解密私钥交付微信。
- 私钥与备份虽分目录，仍在同一NAS及同一SSH信任边界，不等同离线异地保险；所有者应另行离线保管NAS解密私钥。更换公钥前必须保留旧私钥，否则旧备份无法解密。
- 成功后保留最近7个备份日期、4个周、3个月的代表快照；仅清理本工具确认成功的旧代，失败快照不会删除。失败见用户服务日志、last-failure.json，`/status` 会报告备份失败/延期或最后已验证代。不在未知任务上下文中主动推送消息。
- `python3 backup-data.py verify ~/.local/share/wechat-assistant-backups/<代>/core.enc` 重做校验；将verify改为restore导出到 `~/.local/share/wechat-assistant-restore/<代>/core/`。media.enc同理。目标存在则拒绝覆盖，不能恢复到运行目录。
- 导出的恢复副本中未完成队列统一标uncertain、未处理原始收件标cancelled；必须核对官方任务和账号配置再人工切换，绝不能直接启用或重放。core及media都恢复后按manifest核对路径。恢复不会自动启动机器人。NAS解密需要已有SSH访问；树莓派完全损坏时须先用所有者独立的NAS访问恢复备份和密钥。
- 计划升级前在独立systemd任务中运行 `node backup-upgrade.mjs`：先完成备份验证，再调用现有空闲重载。普通服务重启不自动等同代码升级。当前不清理原始附件、日志。


## 独立消息与收件确认

已移除收集附件、/collect和“开始”触发流程，不按时间或序号跨消息自动合并。每条SDK消息独立持久化、处理；同条item_list里的文字与附件一起提交。附件无文字也立即下载并提交查看，不等待后续说明；后续文字由Codex结合会话理解，不重提原附件。原始消息和队列重启恢复继续按条处理。
接入层保存后直接确认收到，不调用模型；已有任务则提示排队。/stop、/exit仍取消当前任务和队列。收件通知用持久化claim防重复，发送失败不阻止执行。

## 附件延迟分层定位

`ingress-trace.mjs` 包装已安装SDK的getUpdates、HTTP executeRequest、parser.parse和本程序回调，不修改node_modules、不改变消息组合或重试行为。记录poll/http起止、接口返回消息数量、每条seq/源时间/消息ID哈希/元素类型数量、分组字段是否存在、解析与回调相对返回耗时、原始收件持久化、下载及预处理耗时。正常轮询按请求边界记录，不输出固定心跳。事件循环超过200ms才记录延迟；日志继续使用原有有界轮转。

同一poll的trace_id关联其wire/parse/callback，message_ref哈希关联下载与预处理；HTTP每次尝试单独trace。不会记录正文、用户原始身份、context_token、cursor、原始client_id或下载URL。源create_time只用于辅助，跨设备时钟可能有偏差；API返回前的延迟不能再细分为微信上传、服务器队列或网络，需要上游证据。SDK组件升级后须核对包装入口。


## 附件任务续接体验

每轮Codex可用nonce绑定的任务状态尾块明确声明唯一阻碍为等待附件；接入层剥离尾块，保存用户原请求、线程和逻辑任务编号，不发送完成标识，/status显示等待附件。下一轮若为附件，沿用原逻辑任务编号并提供原请求继续处理，最终才发送完成标识。不是按时间猜分组，没有固定等待、收集或开始命令。新普通请求会结束旧等待关联；/stop取消等待，/new清空等待。保持实际每条消息独立提交及队列对账，底层可能仍有两次推理。非等待任务的结束通知不受影响。

## CodeGraph 本地代码索引

已独立安装 `@lzehrung/codegraph@3.0.1`，CLI为 `<用户安装的 codegraph 路径>`，不加入机器人运行依赖，不启动后台服务、不上传源码。项目索引位于 `.codegraph/`，配置排除依赖、旧备份、refactor-stage和outputs。

在本目录运行：
- `codegraph orient --root . --budget small` 查看架构入口。
- `codegraph search 'send' --json` 定位符号，复制返回handle供后续查询，不猜行号。
- `codegraph deps bot.mjs --json` 查看模块依赖。
- `codegraph callees 'symbol:codex-session.mjs:send:196:9' --depth 2 --json` 查看当前版本send调用链；行号变更后重新search。
- `codegraph callers <handle> --json` 查调用方。
- `codegraph duplicates . --limit 20` 检查疑似重复，不能仅凭结果删除代码。

已验证64文件索引；原生ARM64解析61个源文件，无降级解析。已验证bot入口依赖和SessionManager.send语义调用。报告保存在.codegraph/reports，仅是静态证据，不保证完整覆盖动态import、SDK事件回调、远程调用或Python子进程；这些需配合运行日志和源码核对。后续分析优先用图索引，并关注freshness及truncated/omitted字段。


## 冗余清理

已移除无生产调用的text-stream及其专用测试，移除旧extractMemory/UserMemory.extract，存储隔离/容量/遗忘保护测试直接覆盖现有存储入口。每轮仅查询一次召回记忆。同一次/stop或/exit共用一个中断Promise，目标trace变更后不发旧任务中断，远程seal/精确stop及核实保留。历史refactor-stage移至~/.local/share/wechat-assistant-archives/，不作为当前运行代码或索引范围。

## 收件与恢复可靠性

同一用户的普通消息在附件下载前进入串行接入队列，保持SDK接收顺序；不同用户相互独立，控制命令不排队。收件确认异步发送，失败不阻塞提交。该顺序只保证已经到达程序的消息，不猜测微信端尚未送达的附件。

提交前将逻辑任务编号、原请求、附件续接关联及任务状态nonce保存到收件SQLite的jobs.context；恢复使用该记录，兼容旧任务无context时的原有编号。只有提交已确认后才消费等待附件关联，失败仍保留。恢复后的等待附件状态不发送结束通知，未知提交继续按原clientUserMessageId对账，不重复执行。

记忆归档、淘汰与写入、删除封锁、清空操作分别使用SQLite事务，任何一步失败时回滚整组修改。

## 材料与任务关联

每轮额外提供本轮材料清单（稳定材料ID、名称和类型）、已接收待处理附件数量与续接标志。ID由持久化消息ID和附件路径派生，不跨用户共享；同路径视觉输入去重，逻辑任务材料快照存于jobs.context，重启继续使用。普通日志只记数量、关联原因和任务状态，不写材料名称、路径或正文。

共享开发者提示禁止在未明确指定历史材料时自行使用旧文件；需要材料而本轮没有时进入现有waiting_attachment生命周期。明确指定历史材料仍可复用，候选不唯一则澄清，不以时间/序号猜分组。该策略依赖Codex遵守材料约束，不是对文件系统读取的硬隔离；目前未增加第二套意图模型或工具代理。已接收但未下载完的附件计入pendingMaterials，尚未到达SDK的文件无法预测。

### 材料流程简化
材料规则集中于共享developerInstructions，每轮materialInput只携带当前材料、待处理数量和续接状态。首轮完成时重新检查已持久接收的待处理附件；若已有附件，发送“请求已保留，正在核对已收到的附件。”，保留waiting_attachment状态，不提前发结束通知。此检查不按时间自动合并、不增加等待、不跳过不确定意图的判断，也不保证减少官方推理轮数。

### 精简通知

普通消息和独立附件保留一次收件确认。附件到达时若已有等待任务，不再重复确认；若前轮仍在推理，附件确认延后到持久队列实际提交时判断：明确续接不发，独立任务仍发一次。按消息ID和持久化receipt claim防重复，不按到达时间猜任务归属。首轮等待结束时若已有待处理附件，保留任务状态但省略额外等待气泡，delivery记录not_required；没有附件时仍发真正等待提示。续接短开场通过共享提示词避免，保守过滤空泛读取开场，关键发现、错误、数字结果及问题继续发送。完成标识不受影响。

## 微信原生正在输入
每个账号独立TypingStatus，依据SessionManager实际执行/发送状态更新，活跃时每8秒刷新，1秒检查生命周期；停止、结束、等待交互或等待附件时关闭。连接初始化本身不点亮。请求串行，晚返回的开启请求后继续关闭，失败只记录安全诊断不阻塞业务。间隔是本地刷新策略，不是服务器显示有效期保证；微信决定显示文字及手机端可见性。服务退出清理定时器并尝试关闭。

## NAS 源码仓库与恢复布局

Git 远端由部署者自行设置。顶层是机器人源码；`agent-workspace/`是当前独立工作目录中远程适配器、目标配置和AGENTS.md的交付快照，运行目录仍为`~/work/wechat-assistant`，更新该适配器后提交前应同步快照。全新恢复时将该目录内容放回工作目录；不要覆盖已有remote-sessions.json、私有目录或outputs。凭据、会话、SQLite数据库、聊天附件、日志、备份、依赖和CodeGraph索引不纳入Git。

## 微信文字排版

发送层保留既有表格转逐项记录的展示，默认不生成表格图片。标题和加粗去除标记，无序列表转圆点；原有编号保留。网页链接显示名称和完整URL，本地交付链接显示附件名称，附件仍由OutputStore在文字转换前识别和快照保存，之后发送真实图片/文件。行内代码只去掉外层反引号，围栏代码内容不改；长消息继续按既有传输限制分段。材料状态、记忆提炼和任务结束通知不受影响。

### 选择旧对话继续

- `/sessions`：列出当前机器人账号下、当前微信用户自己的主助手对话（当前对话及最近最多20个历史记录）。
- `/resume 2`：恢复最近一次列表的第2项；也可用 `/resume 完整会话ID`。不带参数时展示列表。
- 恢复使用官方 `thread/read` 与 `thread/resume`，不调用 `thread/start` 新建，也不启动新终端。下一条消息继续原来的历史；恢复后重启仍保持选定会话。
- 只能选择该用户已有的会话关联，不扫描/导入 Codex 全局历史；未记录归属的旧会话不会自动认领。远程主机项目会话仍通过原远程适配器的 list/attach 操作。
- 本地任务执行、最终回复发送、排队或未确认任务时禁止切换。当前对话存在未确认停止的委托远程任务时先用 `/stop` 核实。目标会话活动中、目录不匹配或恢复失败时保留当前关联。
- 切换不迁移附件等待、上一轮结果或取消规则；不重放任务，不自动恢复正在执行的工作。原生记忆按 Codex 数据目录隔离。

### 每日 RSS 新闻（按账号配置，模块解耦）

`wechat-news@<account>.timer` 在北京时间 09:00、12:00、18:00、21:00 触发短命的 `news-job.mjs`，不会每分钟空跑；它按账号私有 `notification-jobs.json` 的北京时间检查发送时刻，只读取指定时间窗口内的 RSS/Atom，不创建 Codex 会话。`rss-news.py` 负责受限下载、日期过滤、ID 去重和 HTML 转纯文本；`news-compose.mjs` 每批最多调用一次模型做语义去重与聚合，失败时保守保留完整采集正文。HA Feedreader 可独立订阅同一来源，不参与微信发送链路。

配置在对应账号 stateDir 下（600 权限），格式：

```json
{"jobs":[{"id":"zaihua-daily","kind":"rss-news","enabled":true,"time":"09:00","startDate":"2026-10-20","recipient":"该账号授权的微信用户ID","title":"在花科技圈早报","url":"https://rss.example.com/telegram/channel/example","limit":8}]}
```

- 当前 timer 固定在北京时间 09:00、12:00、18:00、21:00 运行；若修改任务时刻，需要同步修改对应账号的 `wechat-news@<account>.timer` 并执行 `systemctl --user daemon-reload`。改任务配置本身无需重启。暂停：`enabled:false`，或停用对应 timer。配置不得提交 Git。
- 安装模板到 `~/.config/systemd/user/` 后，`systemctl --user enable --now wechat-news@default.timer`；其他账号分别启用各自 timer，不复制收件人或授权配置。
- `WECHAT_ACCOUNT=default node news-job.mjs --dry-run`：只读取和排版，不发送；会忽略时刻和 startDate 以便预览，仍需 enabled。
- `WECHAT_ACCOUNT=default node news-job.mjs --force zaihua-0900`：按需预览指定且已启用的 RSS 任务，忽略定时时刻，窗口从该账号最近一个计划节点开始到当前时刻；生成 HTML/图片并输出交付路径，不发送微信、不占用当天的定时发送 claim。`--dry-run` 与 `--force` 互斥。
- 调度器通过原有私有 runtime.sock 的 `/scheduled-jobs` 与 `/scheduled-text` 接口工作，发送端按配置解析收件人并再次校验授权，不信任请求中的收件人。消息仍由原 `OutputTransport` 排队发送。
- `scheduled-delivery.sqlite` 仅保存 job+北京时间日期的发送 claim/status，SQLite WAL/FULL 保证并发和重启不重复。接口接受不代表用户已读。中途崩溃、部分失败、超时或未知状态不自动重发，避免重复打扰；应核对后人工处理，不通过改 job ID 绕过去重。
- 接入程序维护或离线会拒绝当次发送；`Persistent=true` 可让 systemd 在计时器恢复时尝试补跑错过的一次触发，但运行失败、未知送达及超过窗口都不自动重发。来源失败不误报“无新闻”。此方案不保证每天必达：网络、微信接口、订阅源都可能失败；`journalctl --user -u wechat-news@default.service` 查看不含原文/凭据的执行结果。
- 不新增常驻服务、MQ、发送引擎或 Telegram 登录；一个短命系统定时任务复用原发送能力。没有部署新闻列表卡片或配置 HA 自动播报。

验证：`node --test *.test.mjs`；`python3 rss-news.test.py`。

### 定时新闻聚合

`news-job.mjs` 按配置的同一任务 `sources` 采集，先由 `news-compose.mjs` 做精确去重并进行一次受校验的语义聚合，再由 `news-digest.mjs` 渲染分类、聊天预览和完整 HTML。分类为 AI与科技、财经与商业、教育、国际动态、国内与社会、其他动态。模型失败、输出校验失败或输入超预算时保留完整采集正文；部分来源失败会在正文注明，全部失败不发送空白成功结果。去重范围为同一采集窗口，不代表跨时段已读去重。发送继续使用既有 ScheduledDelivery 和 OutputTransport。

### 新闻完整性修复（2026-10-19）

RSS `summary` 保留来源正文（单条安全上限16000字符，超过时标记 `summary_truncated`），优先读取 content:encoded/Atom content；旧 `excerpt` 仅作兼容输入，不作为 HTML 原文。采集默认每源最多80条，最多100条，仍只覆盖订阅源实际返回且满足任务窗口的消息，不保证全天完整归档。

统一 `renderDigestHtml` 输出本批全部去重条目、完整句导读及可展开的采集正文/来源版本。HTML保留条件、预测措辞和具体数字；聊天仅预览并明确标注省略条数，不能拿预览继续生成完整报告。正文全部转义，禁用脚本与外部资源。相同标题但正文数字不同不会只因标题相同合并；同一链接的不同正文版本仍保留。标题分类优先，减少背景词导致的误分类。

定时任务把HTML写入工作目录 outputs/news/用户哈希/，通过既有 ScheduledDelivery、OutputStore、OutputTransport发送，沿用原任务幂等记录，不另建发送服务。`NEWS_INSTRUCTIONS` 经共享 `ASSISTANT_INSTRUCTIONS` 注入新建/续接轮次，约束新闻默认走 RSS、事实保真、元数据分离和 HTML 直接交付；每批只调用一次新闻语义聚合，不启动常驻会话。

### 新闻输入结构与固定模板

当前采集结构为 `{id,title,summary,published,summary_truncated}`。`id` 是本地哈希；发布时间统一UTC ISO格式，脚本按24小时筛选并数值排序。summary是去除HTML后的来源内容，不是模型新写的摘要；沿用16000字符安全上限并显式标记截断，避免180字符硬切丢条件。链接不再输出。

`modelInput` 只保留 `{title,summary}`，按时间筛选与保守去重后写入相邻 `.model-input.json`，不包含来源URL、时间、统计字段；当前只是准备下一步模型输入，不会偷偷调用Codex。`news-template.html`由Codex设计一次并固定复用，渲染器负责转义及插入数据；不再每批重写整份HTML样式。旧文档中“展示来源链接”已由本节明确替代。

### 新闻不归档原始版本

当前规则覆盖此前中间JSON和来源版本留存设计：来源内容仅本批内存处理，不再写 `.model-input.json`；历史自动生成的四份中间JSON已清理。HTML只展示一份完整合并内容，无采集正文/不同来源版本展开区，无重复导读。仅保留实际交付所需HTML及发送去重状态，不建立新闻原文档案库。既有用户已收到文件和会话历史不由此自动清除。

### 顶部重点新闻与Codex技能

固定模板顶部新增重点区。当前无模型调用时只展示金融、科技、教育每栏至多一条规则初选，并明确标注，空栏目不凑数。Codex技能 `~/.codex/skills/news-highlights/SKILL.md` 定义影响、时效、信息充分度的选题标准和事实/影响/后续/不确定性拆解。后续调用者可把符合技能schema的结果作为renderDigestHtml的highlights参数传入；标题须对应输入新闻，未知标题拒绝，所有文本转义。不会因创建技能自动增加定时模型调用。

### 定时发送进度修复

ScheduledDelivery持久化实际发送包与分段/附件检查点，用于交付恢复，不是新闻原文归档。沿用账号私有SQLite WAL/FULL数据库。定时发送启用continueTextFailure：某段正文失败仍处理后续未尝试文本与HTML；整体存在unknown/failed时返回partial，不虚报accepted。日志仅记录脱敏错误码、HTTP状态和数值API码，不保存原始错误正文或凭据。

新闻定时消息缩为单条通知与HTML链接，完整新闻不再拆成多条长正文。显式恢复通过既有私有/scheduled-text接口（实际路径无空格）提交 `{jobId,occurrence,resume:true}`；仅处理本账号配置的任务，仅发持久化包中尚未尝试的部分，accepted/unknown/sending对应的不确定发送不会重发。旧任务没有检查点时返回SCHEDULE_PROGRESS_UNAVAILABLE，不能推断未送达。历史unknown任务不自动补发。

每日新闻图片：news-job.mjs 调用 news-image.mjs，使用固定 HTML 模板及本地 Playwright Chromium 截图，不调用图片模型。依赖 playwright-core 1.64.1、其对应 Chromium、本机字体 ~/.cache/news-fonts/NotoSansCJKsc-Regular.otf；树莓派共享库复用 ~/.cache/mova-browser-libs。默认输出一张完整长图，另附完整HTML；仅显式mode=pages时按最多1800像素高分段、最多7张；不丢弃尾部内容，超过限制或渲染失败则仅交付HTML并提示。浏览器禁用页面脚本和网络，45秒关闭；定时服务超时240秒。测试不会发送微信。

新闻混合去重：news-dedup.mjs 先复用确定性去重，再用标题相似度筛候选，一批最多调用一次本机官方 codex exec；同进程相同批次结果复用。仅传候选标题和完整摘要（去除链接，不传来源/时间），总输入超过80000字符则明确回退，不截断。Codex使用现有ChatGPT登录，ephemeral、只读、禁用shell/多智能体/搜索，90秒超时清理本次进程组；仅接受schema中的下标分组。候选外、重复/非法编号、数字不一致或非两两候选分组一律回退。未分组条目原样保留，合并只拼接原始摘要，不由模型改写。输出元数据记录批次指纹、采集数、算法数、AI状态和最终数，不归档输入JSON或模型会话。不重启机器人；news-job每次独立加载代码。

新闻原图：宽度不超过2048且高度超过2048的PNG长图以原始字节作为微信图片上传，仍受4000万像素/50MB总量限制；不做2048长边缩图，不转文件。其它图片保持原有规范化。接口接受不保证微信客户端最终显示品质。

新闻长图默认以JPEG质量80（4:4:4、不缩尺寸）从固定HTML导出。长PNG/JPEG以原字节作为微信图片上传，发送层不再二次缩小或转码。80是编码质量参数，不承诺文件体积固定为80%。

### 新闻正文结构整理

`news-job.mjs` 在混合去重之后调用 `news-organize.mjs`，通过现有官方 Codex CLI、low 推理档位和 `news-organize.schema.json` 一批调用完成结构整理。仅把本批完整原句与标题放入内存传给模型，链接不进入模型输入，不保存正文中间JSON。模型只能选择固定小节标签、排序及分段，并返回文章和原句编号；正文由程序从原句重建，不接受模型改写。所有文章、所有原句必须恰好覆盖一次，正文数字、条件、期限、不确定性及来源冲突均随原句保留。重复表述由上游去重负责，结构整理不擅自删句。

输入超过预算、超时、无效编号、重复或遗漏均保守回退到完整正文；正文结构状态显示在HTML批次元数据。批次内缓存避免重复调用。HTML保留段落和小节，标题图片继续隐藏 `.original` 全部正文。验证：`node --test news-organize.test.mjs news-digest.test.mjs news-dedup.test.mjs news-window.test.mjs scheduled-news.test.mjs`。

正文清理补充：结构整理前只清理明确匹配的频道前缀、投稿尾注和独立来源标签；相同原句或已被较完整原句逐字覆盖的句子只保留一份。模型可用 `duplicates: [{id, coveredBy}]` 标记重复，但每个输入编号仍必须有唯一去向。程序独立核对标记是否被保留句逐字覆盖（仅忽略空白和普通标点），无法证明的语义重复自动恢复到正文，不以模型判断直接删除条件、数字、归因或不同口径。原始采集正文不修改；组织失败依旧回退完整采集正文。

可靠性补充：每次模型调用最多6篇，最多两个调用并发，避免大批输出的编号遗漏及超时。模型重复引用同一原句时只展示一次；未列出的原句以及无法核实的重复删除请求均原样补回。越界编号、文章ID错误、结构错误或任一调用失败仍回退整批完整正文，不宣称整理成功。

原句输入改为显式 `{id,text}`，避免模型把数组下标误从1计数。无效原句引用不生成任何文字；真实原句若未被有效引用就自动补回，确保不会因编号异常丢内容。`restoredUnits`记录自动补回数量。文章ID/结构错误仍整批回退。正文整理只删除明确来源杂项、确定重复；不能证明的同义表述仍保留，避免数字、条件和归因损失。

### 正文语义合并（当前策略）

模型负责跨来源选择表述、自然分段并提出同义重复删除及对应保留句。对于非逐字重复，程序先检查数字与关键限制词，再由独立模型复核主体、时间地区口径、归因、条件、期限和不确定性是否完整覆盖；只有复核明确批准且程序检查通过才删除。无法核实、复核失败或超过预算时恢复原句，不擅自删除独有信息。不让模型改写正文或创造事实。`semanticRemoved`与`restoredUnits`记录处理结果。完整信息校验与模型复核均有局限，不代表独立核实新闻真实性。

正文不展示模板小标题，长段按原句边界拆分；顶部重点区只列标题，避免重复展示未整理的原始摘要。原始正文只在内存处理。`outputs/preview-semantic-news.mjs`（微信工作目录）可复用已发布早报中的三篇问题文章进行验收，不重新采集、不改定时发送记录。

模型输入按事实分句编号（保留原文标点，不含链接），使一条长句中的重复参数与新增容量/资格等信息可以分别选择。复核未批准或模型遗漏的分句补回邻近的原始上下文位置，而非统一追加到文末，避免形成第二个来源摘要尾巴。HTML最终仍仅显示连贯自然段，不展示内部标签或编号。

## 当前生产新闻流程：模型全文聚合（替代旧拆句流程）

`news-job.mjs` 现在只调用 `news-compose.mjs`，不再调用 `hybridDedup` 或 `organizeArticles`。程序只处理时间筛选、基础纯文本采集、完全相同标题和正文的去重，以及输出格式/文章编号/去向覆盖校验。它不再做相似度候选筛选、句子拆分、同义删句、数字门槛决定是否合并或二次模型删句复核。

模型一次读取完整文章，自主进行事件聚合、同义去重、摘要与自然段组织，输出 `news-compose.schema.json`：`stories[{sourceIds,title,category,paragraphs}]`。每篇输入文章编号必须恰好归属一篇输出文章，不允许遗漏、重复归属或虚构编号。`stats.mapping`含原始采集下标去向，完全重复副本也包含在计数内。合并数量减少不等同于文章遗漏。

原始 `summary` / `variants` 保持不变，仅在内存中保留；模型生成的展示摘要单独写入 `structuredBody`。来源链接和程序时间字段不进入模型输入，不另存原始正文中间JSON或来源版本。最终HTML展示一份聚合摘要，不展开原文版本；图片只展示标题。正文不用“概况”等模板小标题，段落由模型决定，HTML不再按长度拆句重组。

提示词要求保留主体、日期、数字单位、地区口径、条件资格门槛期限及不确定性，禁止补写事实。程序不宣称自动证明摘要事实完整；覆盖校验只能证明文章有去向。模型失败、超时、超预算、结构错误或文章去向不完整时，整批回退完整采集正文并标注，不丢弃失败文章，不截断输入后再总结。完整正文最长输入120000字符，模型超时180秒，复用现有CLI low档位及批次内缓存。

验证：`node --test news-compose.test.mjs news-digest.test.mjs news-window.test.mjs scheduled-news.test.mjs`。旧组织模块保留供历史测试，不属于生产主链路。

### 微信文字多会话

发送“列表”（兼容“会话列表”）“新建 名称”“切换2”“历史”“历史2”“翻页”或“搜索 关键词”。`/sessions`、`/new 名称`、`/resume 编号`为对应别名。历史每页5轮，长消息显示节选；搜索范围为指定当前会话最近50轮，不冒称全库搜索。历史中的附件链接只显示标注，不重新发送。已有当前会话及记录中的历史thread迁移到个人编号列表。

每个会话使用独立内部执行键、Codex thread、队列和取消范围。原始消息在到达时绑定执行键并保存，切换不改派旧消息；管理指令绕过推理任务队列。外发仍映射真实微信用户，原生记忆按 Codex 数据目录共享。多会话时输出附来源编号。`/stop`只取消当前会话；已切走的任务需要切回后停止。历史查询不改变原会话回复回调。旧`/codex new`保留原兼容行为。

上线需等待账号运行及发送全部空闲后重启，不能在活动轮次中强制重启。当前账号状态中`features.text_conversations`表示新代码已加载。

会话标题以Codex的thread.name为唯一权威来源；“新建 名称”及“命名 名称”通过thread/name/set写回Codex，再读取确认。本地仅缓存显示，列表重新读取官方标题，并处理thread/name/updated通知；未命名时显示占位名，不用本地摘要覆盖官方名称。普通轮次结束只显示结束/失败/停止状态，主机名和任务编号留在内部记录，仍可通过状态查询排查。

中文任务控制统一为两个字：状态、停止、结果、恢复、退出、余额、模型、记忆、帮助。原有长指令仍兼容。对应原status/stop/result/recover/exit/help，英文斜杠命令继续兼容。仅完整指令被拦截，含这些词的普通业务请求仍进入Codex。恢复任务只对账原执行，不自动重提；停止任务只作用于当前会话。

会话状态以官方 Codex app-server 为核心：新建立即执行 `thread/start`（经现有 SessionManager），命名使用 `thread/name/set`，连接已有编号通过 `thread/resume` 并核对官方 thread ID；已有活动连接只复用官方连接，不重启其任务。补充仍使用 `turn/steer` + expectedTurnId，停止仍使用原有 `turn/interrupt` 与远程归属核实。

会话归档：`归档2`调用官方 `thread/archive`；`还原2`调用 `thread/unarchive`，保留历史且可恢复。`删除2`明确调用官方 `thread/delete`，永久删除指定会话及其派生子会话，不能还原；不再作为归档别名。删除前校验归属、运行/排队/未知状态及已登记派生会话；官方成功回执或只读对账确认后，微信仅保留编号及已删除状态，清理该会话未读展示缓存。官方 `thread/deleted` 通知同步删除状态，已删除编号不会复用、继续或还原。写入前持久化删除意图；回执不明不自动重发，后续列表查询对账。永久删除只在用户明确使用删除命令时执行，代码升级不自动删除任何既有会话。写入前持久化意图，写入后重新查询官方状态；回执丢失先对账，不自动重发。官方拒绝时不做本地成功标记，查询失败时明确未确认。执行、排队、发送中或结果未知时拒绝更改归档，编号保持不变。

微信仅持有账号/用户归属、稳定编号、当前路由与展示缓存，不另设独立的 Codex 归档事实。列表全量分页查询官方活动及已归档线程（所有 provider/sourceKinds），只投影本用户登记的 thread ID，不导入其他用户的会话。外部客户端的归档/还原覆盖微信缓存；官方通知也同步缓存。官方记录缺失时明确标注，不能静默创建替代 thread。首次恢复连接先核验官方归档状态，避免已归档线程被正常消息意外恢复。历史使用只读 `thread/turns/list`，不调用 resume。

0.163.0 的 `thread/list` 会省略部分无消息的空白线程；这些线程改用归属已核验的 `thread/read`，优先由持有该空白线程的原连接查询。当前协议没有 archived 字段时，通过官方返回的 rollout path 中 sessions/archived_sessions 位置确认（已在该版本实测，升级需复验），不直接读取或修改 Codex SQLite。尚未建立 thread 的旧空白导航项仅能在本地隐藏，展示为尚未连接，不冒称 Codex 会话。

归档当前会话自动选择其他未归档会话；最后一个会话需先新建。新建/切换失败回退原路由，连续新建按收件绑定分别确认其官方 thread，不以异步完成顺序覆盖后到消息。

### 微信账号与 Codex 运行环境绑定

`backend-manager.mjs list` 读取配置；`inspect ACCOUNT pilot-a` 仅做目标预检；`bind ACCOUNT pilot-a` 在账号空闲、原环境及目标环境都没有排队或未确认任务时切换。`bind ACCOUNT host` 返回宿主机。绑定操作使用锁，先通过原私有 runtime 接口 drain/seal 停止指定账号，再原子写入该账号 `codex-backend.json` 并启动，核对新 runtime 的实际 backend ID；启动失败回滚旧配置。不会全局重启机器人、停止容器 app-server 或重放旧任务。

容器首次接入不复制宿主会话：Codex thread/记忆归属于容器自身；微信会话目录、任务结果、收件队列使用 `账号目录/backends/pilot-a/` 独立命名空间。原宿主目录保持可回退。微信登录凭据、授权名单、附件下载、日志、runtime.sock 仍归账号目录管理。回退前也需处理当前后端的未确认任务。一个容器只允许绑定一个微信账号，原生记忆模式要求一个授权用户，避免共享原生记忆跨用户串用。

正式和试验链路复用同一个 PodmanRpc，仅传输官方 WebSocket RPC；SessionManager 的会话、补充、停止和对账逻辑不复制。关闭代理不会停止 app-server。目录查询使用同一后端工厂，不能回落到宿主线程库。容器中不可用的宿主远程适配/SSH 不冒称可用。

只复制当前账号明确附带的文件及预处理图片/音频到该容器 workspace/inputs，原始收件记录仍保留宿主路径；模型输入使用对应容器路径。产物仅从 `/workspace/outputs/` 和原生 generated_images 目录读回，经原 OutputStore 大小、格式、摘要与发送检查；拒绝越界、凭据路径和符号链接重定向。后台命令停止仅处理当前轮 item ID 归属的官方终端，不杀其他轮或其他容器。

原生记忆与微信逐条记忆不双写。容器账号的 `/memory` 查询官方 memory/status，`/memory auto on|off` 控制当前官方会话的 memoryMode；不把逐条编辑/清空命令伪装成官方支持的操作。宿主账号同样使用原生记忆。私有 runtime `/status` 显示实际 backend ID/kind/container，账号列表读取此信息；配置文件和运行态未确认时不报告切换成功。

验收证据：`codex-backend.test.mjs` 覆盖路径边界/原生记忆/导出/命令归属，`codex-backend-live-check.mjs` 使用隔离测试状态运行真实附件、图片、文件返回和原线程重连，`codex-backend-stop-live-check.mjs` 验证真实命令停止及另一容器不受影响。测试不发送真实微信消息、不切换账号、不迁移旧历史。正式账号对应关系必须由用户明确选择。

宿主机和容器运行账号统一使用 Codex 原生记忆：生产入口均传入 memoryMode=native，跳过微信自建 UserMemory 的创建、召回及自动提炼；/memory 查询官方 memory/status，auto on/off 调用当前 thread/memoryMode/set。宿主机需启用 features.memories。旧 user-memory.sqlite 保留但不迁移、不继续读写；既有聊天上下文不会因此清空。原生记忆的范围是对应 Codex 数据目录，宿主机其他共用该目录的客户端也属于同一范围；记忆生成由官方调度，不保证开启后立即产生记录。


## 当前记忆实现（替代前文旧自建记忆说明）

自建 SQLite 事实存储、FTS 召回、来源副本、nonce 自动提炼和逐条管理实现已移除，旧 user-memory.sqlite 仅保留历史备份。运行环境显式启用 features.memories、memories.generate_memories 和 memories.use_memories；thread/start 和 thread/resume 使用相同官方配置并在成功返回后调用 thread/memoryMode/set(mode=enabled)。不在每次 turn/start 重复开启；手动关闭维持到下次连接。/memory 只查询官方状态，auto on/off 调用官方会话模式接口，旧逐条编辑/清空指令明确不支持。历史回复仅保留显示层尾块过滤，不解析、不保存候选。原生记忆由对应 Codex 数据目录管理；旧库提交的迁移资料是否被整合应以官方结果核实，不保证逐条迁入。

## Weixin iLink 协议升级计划与实现

按顺序实施：① uint64 ID 无损解析、发送回执与未知状态禁止自动重试、游标前持久化；② 完整引用（svr_id、partial_text）与动态轮询；③ SILK 语音输出、工具开始/结果消息。依据 Tencent/openclaw-weixin 的 src/api/api.ts 与 types.ts，接口路径不额外猜测。

当前适配固定 SDK 2.2.0；sdk-protocol-patch.mjs 使用可重复执行的版本契约补丁，npm postinstall 自动重放。原始用户消息保持独立；授权消息在游标保存前登记会话路由、持久化原始收件，失败不推进检查点。控制消息不恢复重放。发送响应 ID 写入同一收件 SQLite 的 weixin_sent，状态区分 sending/accepted/failed/unknown；未知状态不得自动重投，accepted 不表示用户已读。ID 按字符串保留，引用按账号与真实接收人隔离；缺失原文明确为 null，不自行猜测或读取引用附件。引用作为独立资料段进入 Codex，原始文字不改写。

轮询遵从服务端建议，HTTP 截止时间为建议值加5秒，本地限制10..120秒。WAV/MP3/SILK 的显式交付链接输出语音气泡，宿主适配器负责转24kHz单声道SILK，容器只需生成输出文件；本地保护为输入10MiB、时长60秒（非服务端保证）。不提供语音合成模型；只有实际交付音频才转换。语音提交与普通媒体共享状态/快照，不自动重发未知结果。工具状态映射真实 Codex item started/completed，仅传工具类型与状态，不泄露命令正文；按 thread/turn/item/阶段生成稳定client_id，避免重连盲目补发。腾讯协议类型11/12的微信客户端展示、语音真实播放仍需实际微信验证，模拟接口测试不等于用户端验收。


### 原生语音实测修正

真实提示音测试已确认编码可解码、voice上传和sendmessage获接受，但用户反馈没有气泡、只有文字。不能把协议类型存在或API接受当作客户端可用。默认WAV/MP3/SILK按音频文件发送；只有显式设置WECHAT_NATIVE_VOICE_EXPERIMENTAL=1才转原生语音。voice_output不再报告已验证支持，audio_file_output标记文件能力。已提交的实验语音不自动重投；需要另一次明确交付。腾讯问题参考：https://github.com/Tencent/openclaw-weixin/issues/215 。

### 收件与长轮询审查修正

游标先经原子临时文件写入、fsync、rename、目录fsync，再推进内存游标；落盘失败时不跳过该批。授权业务消息先保存会话归属，再以SQLite WAL/FULL保存原始收件，之后才确认游标。去重查找使用真实微信用户与服务器message_id/client_id，不随会话切换改变；升级兼容既有ingress记录ID并保留最初路由。新索引支持该查找，不重写旧历史。原先以Number保存的超安全范围ID无法无损恢复，不伪造修正，不重放历史任务。

长轮询正常超时返回同游标空批次；停止Abort必须继续传播，不当成正常超时。长轮询不走HTTP层多次重试，真实故障由外层有界退避控制。每次请求从当前凭据读取baseUrl/token；会话过期等待重新登录处理完成，避免旧token反复请求或并发扫码。动态时限仍为服务端建议加5秒、本地10..120秒边界。文本/语音接口接受状态不等同微信客户端显示或已读；原生接口绕过SDK仍不可见的语音问题不能归因于SDK封装。

### 工具状态与引用审查

工具状态发送在进入外发队列前及真正提交前两次验证同一取消token、thread、turn及任务活动状态；停止、换轮、最终回复后不发旧工具事件。仅允许已知工具类型，发送类型与状态，不发送命令、参数、正文结果。非零exitCode、failure/error、declined映射failed，interrupted/cancelled映射cancelled；成功的官方item/completed映射completed。稳定client_id同时包含接收人和thread/turn/item/阶段。提交后无法撤回，因此已提交消息的展示仍由服务端和微信决定。

引用仅恢复同账号同真实聊天对象的出站文本或持久化收件文本，不越界查其它用户。最多8项，标题512、每项原文2400字符；截断显式标注，不把缺失原文当摘要。非安全数字ID不伪造为精确ID；局部选区保留限定字段、检查非负安全整数和起止顺序，不猜测索引单位或据此拼造原文。明确引用作为独立资料输入，不替换用户原消息，不自动读取引用附件。sendQuoted已有底层发送与归属校验，普通回答不会自动改成带引用的消息；微信端展示仍需实际验证，接口接受不是展示成功证明。


### 工具状态真实验收结果

原生工具开始/完成请求获接口接受但无message_id，用户确认微信端没有展示，故不算功能可用。默认关闭原生工具消息发送；仅WECHAT_NATIVE_TOOL_STATUS_EXPERIMENTAL=1保留实验路径。正常有意义的Codex commentary仍按现有文字链路发送，不额外编造通用进度。接口与客户端可见性之间的阻碍未确认，不能断言仅由微信客户端造成。

## 首次安装（当前入口，替代旧手工部署说明）

支持普通用户运行的 Linux arm64/x64、Node.js 24+、用户级 systemd。安装阶段完全由代码处理，不要求已接入 Codex，不调用模型。首次扫码前仍需要本地终端；扫码后优先沿用微信渠道。

```sh
./install.sh
./wechat-setup qr
```

install.sh 在 Node 不满足要求时，从 nodejs.org 下载固定 Node 24.21.0，按官方 HTTPS SHASUMS256 校验后安装到用户私有 tools/node，不覆盖系统 Node；需要预先具备 curl、tar/xz、sha256sum。无需此步骤的环境可以直接使用 node setup.mjs。首次部署仍需系统提供用户级 systemd、flock；缺失依赖由 doctor 明确报告，不让模型猜测，也不自动申请管理员密码。

可拆分执行：

```sh
node setup.mjs init
node setup.mjs deps
node setup.mjs services
node setup.mjs pair
./wechat-setup qr
```

init 只准备私有目录、通用工作区与安装配置，不复制现有微信凭据、授权名单、家庭 SSH/HA 配置。services 生成主服务和多账号模板、daemon-reload，不启动服务；未由本安装器管理的已有服务会拒绝覆盖。pair 先独立扫码，扫码者由 registerLogin 成为授权用户，之后启动微信服务并核实通道就绪。默认账号也支持此独立配对流程，已在线账号拒绝重新配对。二维码默认有90秒保守本地展示窗口，过期运行 account-manager.mjs refresh-qr 对应档案；验证码用其 verify 命令，仅写该账号私有文件。

扫码后直接在微信发送：安装帮助、安装状态、安装Codex、登录Codex、验收Codex。这些是精确匹配的代码控制命令，不进入 Codex 推理。Codex 使用固定已验收协议版本 0.163.0；已有 CLI 不覆盖。设备登录只把官方 auth.openai.com/device 或 /codex/device 地址及本次设备验证码回复给发起者，不输出原始进程日志、令牌或凭据，不记录验证码。已登录不发起替换账号。后台安装/登录具有账号内互斥和宿主安装锁，不阻塞 SDK 接收其它控制消息；维护期间会计入现有 runtime 忙碌状态。

验收Codex 检查登录状态、initialize 和 memory/status，不创建用户任务、不调用模型；protocolReady 不等于模型推理成功。微信 ready 仍只代表通道在线，doctor 单独报告 Codex 是否安装/登录，模型访问应由之后普通消息完成验证。

容器模式：先配置并检查 rootless Podman、Quadlet、cgroup v2 memory 委派，之后：

```sh
node setup.mjs container-create 账号档案
node setup.mjs container-login 账号档案
node backend-manager.mjs bind 微信内部账号ID 创建时返回的backendID
```

创建按微信 accountId 派生专属容器名称，单独数据卷、只读根文件系统、1.5GiB内存、无宿主凭据挂载；Node24 Debian基础镜像中安装固定Codex。首次构建需要联网；不安装Podman、不自动改内核或重启。构建失败保留私有目录供同一身份重试，不覆盖不认识的Quadlet；登录独立完成，不复制宿主auth。绑定仍走原有官方后端预检、空闲切换、失败回退。绑定后的“登录Codex”和“验收Codex”均在该容器内执行，不改动宿主登录。

Node 引导、系统依赖和微信首次扫码不可在尚未建立的微信通道中完成；后续常用管理优先用微信，不要求用户切回终端。系统权限不足、服务冲突、容器基础设施未就绪会明确阻断，不冒称安装完成。


安装审查补充：仅安装私有Node时使用 ./wechat-setup 命令；install.sh 会优先复用已校验安装的私有Node，支持中断后重试。生成服务与配对进程均使用实际Node路径及包含该目录的PATH。容器首次预检失败不再关闭微信控制通道，可通过“安装状态”“启动容器”“登录Codex”修复；普通业务消息在未就绪时不提交模型。设备码提示走控制回复并绕过会话延迟缓存，发送索引仅存脱敏占位，不保存设备码。用户停止/退出引发的取消信号会传给安装/设备登录进程，安装npm进程使用本次操作专属进程组，不全局停止其它进程。已安装文件不会因取消被自动删除。

微信容器引导：“创建容器”→“登录容器”→“使用容器”，最后一步安排空闲后按既有绑定预检切换，并保存 setup-bind-result.json；重复创建会核实并尝试启动已登记的专属容器，不复制宿主凭据。构建镜像仍使用 Node24 Debian 基础镜像标签，Codex版本固定，基础镜像不宣称摘要固定或完全位级可重现。

## 数字安装向导

微信发送“安装向导”进入，每页只显示当前步骤的1、2、3选项。默认3退出；已有的安装和登录会跳过，失败停留当前步骤。向导按真实微信用户独立持久化到账号私有 installation-wizard/，不保存设备码或登录原始日志。重启后可重新打开继续，操作进行中重启时只提供重新检测，不自动重投安装、登录或绑定。

只有向导激活且属于当前Codex会话的纯数字才作为选项。原始收件时冻结选项及步骤revision，排队旧选项不转成下一步的新含义；其它会话及向导退出后的数字保持普通聊天。容器绑定换后端导致执行键改变时，仅允许已确认目标后端接续绑定结果核对。安装/设备登录进行中可回复3请求退出，沿用本轮取消信号终止维护进程，不删除已完成文件。

基础连接检查后仍需选择是否发起一次真实模型测试；只有官方轮次completed才报告本次推理成功，跳过则明确未验证。测试使用当前账号当前会话的官方SessionManager，不建立第二套推理引擎；已有活动任务时拒绝另起测试。

## 许可证与贡献

本项目自有代码和文档采用 [MIT License](LICENSE)，允许使用、修改及商业使用，分发时保留许可证与版权声明。第三方依赖、可选二进制和外部服务不因此变为 MIT，分别遵循其原有条款。MIT 标准文本参见 https://opensource.org/license/mit 。

- [第三方依赖与许可证说明](THIRD_PARTY_NOTICES.md)：列出锁文件中的直接依赖及 FFmpeg 许可差异；不是完整传递依赖或二进制分发合规结论。
- [贡献指南](CONTRIBUTING.md)：开发检查、提交范围与隐私要求。
- [安全报告](SECURITY.md)：漏洞报告方式、敏感信息处理和支持范围。
- [配置说明](CONFIGURATION.md)：账号、SSH、HA 等私有配置与发布内容的边界。

项目是独立实现，不代表微信、OpenAI 或其他服务提供方的官方产品或背书。使用外部服务需自行取得账号与访问授权；项目许可证不授予第三方商标、服务访问或内容转载权限。

## 模块目录

- `src/core/`：任务生命周期、持久队列、恢复和控制接口。
- `src/wechat/`：账号、协议、消息收发和机器人组合入口。
- `src/base/`：智能体底座集合；`codex/` 承载现有实现，`claude/`、`opencode/` 为未启用的预留目录。
- `src/remote/`：远程停止协调；`agent-workspace/` 仍是独立部署的远程适配器。
- `src/media/`：附件准备、文档、图片、音视频和输出交付。
- `src/setup/`：安装向导、平台服务、诊断和后端选择。
- `src/integrations/`：新闻、HA、备份等可选集成。
- `src/tools/`：SDK 补丁、发布检查和维护工具。
- `tests/`：按模块组织的测试；远程适配器测试仍与独立适配器一起保存。
- `assets/news/`：新闻模板、结构化输出 schema 和渲染图片。

根目录的 bot.mjs、setup.mjs、account-manager.mjs 等文件仅保留兼容命令入口；现有安装命令、systemd/launchd/Windows 服务路径和用户私有状态目录继续有效。不要仅复制根目录入口，部署和发布须包含 src/、assets/ 与 agent-workspace/。

运行 `npm test` 执行 JavaScript 测试，`npm run test:python` 执行 Python 测试。真实微信收发、登录和远程执行验收仍需独立授权的测试环境。

Codex 会话入口保留兼容导出；内部拆为 provider-options.mjs（服务商配置与故障判定）、codex-rpc.mjs（进程/RPC 通信）、control-command.mjs（控制命令解析）和 codex-session.mjs（会话协调）。机器人使用 message-processor.mjs 处理消息，bot.mjs 负责初始化、接线及服务生命周期。
