// Each scenario runs in a fresh, temporary Codex thread. Steps in a scenario
// share one thread so that the final answer can use earlier decisions.
export const cases=[
 {
  id:'discussion-advice',
  steps:[{prompt:'我想给十人的小团队安排值班。用共享表格还是做网页？请直接建议一个起步方案。',
   expect:{startsWith:'💡 Zero · 方案讨论',contains:['表格'],notContains:['📋 Zero · 方案共识','📦 Zero · 交付']}}],
 },
 {
  id:'discussion-question',skill:'discussing-designs',
  steps:[{prompt:'帮我规划一个设备巡检系统。我还没有说清楚使用场景，请先确认最影响方案的一个选择。',
   expect:{startsWith:'❓ Zero · 想问你',contains:['💡 Zero · 建议'],questionCount:1,notContains:['📋 Zero · 方案共识','📦 Zero · 交付']}}],
 },
 {
  id:'discussion-consensus',skill:'discussing-designs',
  steps:[
   {prompt:'我们讨论一个设备巡检系统：现场常断网，先只做手机端，巡检员要记录设备状态。你先给我建议。'},
   {prompt:'确定采用离线记录、联网后同步的手机端方案；暂不做桌面端。请整理最终共识，包含目标、做法、边界和验收条件。',
    expect:{startsWith:'📋 Zero · 方案共识',contains:['离线','同步','手机','验收'],notContains:['💡 Zero · 方案讨论','📦 Zero · 交付'],maxUtf16:1500}},
  ],
 },
 {
  id:'discussion-fact-no-trigger',
  steps:[{prompt:'Node.js 24 的主版本号是多少？只回答数字。',
   expect:{contains:['24'],notContains:['Zero · 方案讨论','Zero · 方案共识','Zero · 交付']}}],
 },
 {
  id:'delivery-text-result',
  steps:[{prompt:'请直接交付一份三点的会议议程，主题是下周团队复盘。只需要文字，不要创建文件。',
   expect:{startsWith:'📦 Zero · 交付',contains:['复盘'],notContains:['📋 Zero · 交付蓝图','⚠️ Zero · 需要你处理']}}],
 },
 {
  id:'delivery-blueprint',skill:'delivering-results',
  steps:[{prompt:'我想做一份团队复盘议程，但先给我看蓝图，等我审完再写最终议程。',
   expect:{startsWith:'📋 Zero · 交付蓝图',notContains:['📦 Zero · 交付','🛠️ Zero · 制作中']}}],
 },
 {
  id:'delivery-fact-no-trigger',
  steps:[{prompt:'一天有多少小时？只回答数字。',
   expect:{contains:['24'],notContains:['Zero · 交付','Zero · 交付蓝图','Zero · 制作中']}}],
 },
]
