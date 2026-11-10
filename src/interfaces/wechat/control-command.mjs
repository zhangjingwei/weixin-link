import {memoryCommand} from '../../base/codex/native-memory.mjs'

const english={
 goal:'长任务','goal-status':'长任务状态','goal-pause':'暂停长任务','goal-resume':'继续长任务',
 'goal-complete':'完成长任务','goal-clear':'清除长任务',plan:'计划',review:'代码审查',
 compare:'对比审查','commit-review':'审查提交',compact:'压缩上下文',fork:'分叉会话',branch:'旁支会话',
 'session-status':'会话状态','fast-on':'开启快速模式','fast-off':'关闭快速模式',supplement:'补充',
 stop:'停止',result:'结果',recover:'恢复',exit:'退出',models:'模型',status:'状态',progress:'进度',help:'命令列表',
 memory:'记忆','memory-on':'开启记忆','memory-off':'关闭记忆','resume-session':'恢复会话',
 'reset-session':'重置会话',approve:'批准',reject:'拒绝',answer:'回答',
}

export function controlCommand(text) {
  const raw=text.trim(),command=english[raw.toLowerCase()]??raw
  if(command==='长任务')return {action:'prompt',target:'goal'}
  if(command==='长任务状态')return {action:'goal',op:'get'}
  if(command==='暂停长任务')return {action:'goal',op:'pause'}
  if(command==='继续长任务')return {action:'goal',op:'resume'}
  if(command==='完成长任务')return {action:'goal',op:'complete'}
  if(command==='清除长任务')return {action:'goal',op:'clear'}
  if(command==='计划')return {action:'prompt',target:'plan'}
  if(command==='代码审查')return {action:'review',target:{type:'uncommittedChanges'}}
  if(command==='对比审查')return {action:'prompt',target:'reviewBranch'}
  if(command==='审查提交')return {action:'prompt',target:'reviewCommit'}
  if(command==='压缩上下文')return {action:'compact'}
  if(command==='分叉会话')return {action:'fork',switchTo:true}
  if(command==='旁支会话')return {action:'fork',switchTo:false}
  if(command==='会话状态')return {action:'agentStatus'}
  if(command==='开启快速模式')return {action:'fast',enabled:true}
  if(command==='关闭快速模式')return {action:'fast',enabled:false}
  if(command==='补充')return {action:'prompt',target:'steer'}
  const chinese={停止:'stop',结果:'result',恢复:'recover',退出:'exit',模型:'models',状态:'status',进度:'progress',命令列表:'help'}
  const alias=command.replace(/[。？！!?]$/,'')
  if(alias==='记忆')return {action:'memory',op:'list'}
  if(chinese[alias])return {action:chinese[alias]}
  const memory = memoryCommand(command)
  if(memory)return memory
  if(command==='恢复会话')return {action:'prompt',target:'resume'}
  if(command==='重置会话')return {action:'new'}
  if(command==='批准')return {action:'prompt',target:'approvalChoice',decision:'approve'}
  if(command==='拒绝')return {action:'prompt',target:'approvalChoice',decision:'reject'}
  if(command==='回答')return {action:'prompt',target:'approvalChoice',decision:'answer'}
  return null
}

export function completeControlPrompt(target,text){
 const value=text.trim()
 if(!value)return {error:'请输入内容。'}
 if(target==='steer')return value.length<=12000?{command:{action:'steer',text:value}}:{error:'补充内容不能超过12000字。'}
 if(target==='plan')return value.length<=12000?{command:{action:'plan',text:value}}:{error:'计划需求不能超过12000字。'}
 if(target==='reviewBranch')return /^[A-Za-z0-9._/-]{1,120}$/.test(value)?{command:{action:'review',target:{type:'baseBranch',branch:value}}}:{error:'请输入分支名称，例如 main。'}
 if(target==='reviewCommit')return /^\d{1,2}$/.test(value)&&Number(value)>0?{command:{action:'reviewCommit',selection:value}}:{error:'请回复列表中的编号。'}
 if(target==='resume')return /^\d{1,3}$/.test(value)&&Number(value)>0?{command:{action:'resume',selection:value}}:{error:'请回复列表中的编号。'}
 if(target==='goal'){
  const match=value.match(/^([\s\S]{1,1900}?)\s*\|\s*预算[\s：:]+(\d+)$/)
  if(match){const tokenBudget=Number(match[2]),objective=match[1].trim();return objective&&match[2].length<=9&&tokenBudget>0?{command:{action:'goal',op:'create',objective,tokenBudget}}:{error:'长任务目标不能为空，预算须为最多9位的正整数。'}}
  return value.length<=2000?{command:{action:'goal',op:'create',objective:value}}:{error:'长任务目标不能超过2000字。'}
 }
 return {error:'未知命令。'}
}
