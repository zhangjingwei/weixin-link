import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationCommand,conversationInput} from '../../src/interfaces/wechat/conversation-command.mjs'
import {controlCommand} from '../../src/interfaces/wechat/control-command.mjs'
import {setupCommand} from '../../src/setup/setup-controller.mjs'
import {diagnosticCommand} from '../../src/application/diagnostics/diagnostic-commands.mjs'
import {agentSwitchCommand} from '../../src/setup/agent-switch.mjs'
import {chatUpgradeCommand} from '../../src/setup/chat-upgrade.mjs'

test('project commands have equivalent English names without a slash',()=>{
 const pairs={daily:'日常',list:'列表',new:'新建',switch:'切换',history:'历史',rename:'命名',older:'翻页',search:'搜索',folder:'当前目录','new-project':'新建项目',archive2:'归档2',restore2:'还原2',delete2:'删除2'}
 for(const [english,chinese] of Object.entries(pairs)){
  assert.deepEqual(conversationCommand(english),conversationCommand(chinese),english)
  assert.deepEqual(conversationCommand(english.toUpperCase()),conversationCommand(chinese),english)
  assert.equal(conversationCommand('/'+english),null)
 }
 assert.deepEqual(conversationInput('cancel',{pending:{target:'new'}}).command,{action:'promptCancel'})
 assert.deepEqual(conversationInput('2',{pending:{target:'switch',choices:['1','3']}}).command,{action:'switch',id:'3'})
})

test('task and interaction commands have equivalent English names',()=>{
 const pairs={goal:'长任务','goal-status':'长任务状态','goal-pause':'暂停长任务','goal-resume':'继续长任务','goal-complete':'完成长任务','goal-clear':'清除长任务',plan:'计划',review:'代码审查',compare:'对比审查','commit-review':'审查提交',compact:'压缩上下文',fork:'分叉会话',branch:'旁支会话','session-status':'会话状态','fast-on':'开启快速模式','fast-off':'关闭快速模式',supplement:'补充',stop:'停止',result:'结果',recover:'恢复',exit:'退出',models:'模型',status:'状态',progress:'进度',help:'命令列表',memory:'记忆','memory-on':'开启记忆','memory-off':'关闭记忆','resume-session':'恢复会话','reset-session':'重置会话',approve:'批准',reject:'拒绝',answer:'回答'}
 for(const [english,chinese] of Object.entries(pairs)){
  assert.deepEqual(controlCommand(english),controlCommand(chinese),english)
  assert.deepEqual(controlCommand(english.toUpperCase()),controlCommand(chinese),english)
  assert.equal(controlCommand('/'+english),null)
 }
 assert.deepEqual(conversationInput('approve').command,{action:'prompt',target:'approvalChoice',decision:'approve'})
 assert.deepEqual(conversationInput('stop',{pending:{target:'new'}}).sessionCommand,{action:'stop'})
})

test('setup, service and diagnostics accept English names without a slash',()=>{
 for(const [english,chinese] of Object.entries({setup:'安装向导','setup-status':'安装状态','install-agent':'安装智能体','login-agent':'登录智能体','check-agent':'验收智能体','install-help':'安装帮助'})){
  assert.equal(setupCommand(english),setupCommand(chinese));assert.equal(setupCommand(english.toUpperCase()),setupCommand(chinese));assert.equal(setupCommand('/'+english),null)
 }
 assert.equal(setupCommand('guide'),'manualEn')
 assert.equal(setupCommand('GUIDE'),'manualEn')
 assert.equal(setupCommand('使用说明'),'manual')
 for(const [english,chinese] of Object.entries({diagnose:'诊断','service-status':'服务状态','recent-errors':'查看最近错误','export-diagnostics':'导出诊断报告'})){
  assert.equal(diagnosticCommand(english),diagnosticCommand(chinese));assert.equal(diagnosticCommand(english.toUpperCase()),diagnosticCommand(chinese));assert.equal(diagnosticCommand('/'+english),null)
 }
 assert.deepEqual(agentSwitchCommand('restart'),agentSwitchCommand('重启'))
 assert.deepEqual(chatUpgradeCommand('upgrade'),chatUpgradeCommand('升级'))
 assert.equal(agentSwitchCommand('/restart'),null)
 assert.equal(chatUpgradeCommand('/upgrade'),null)
})
