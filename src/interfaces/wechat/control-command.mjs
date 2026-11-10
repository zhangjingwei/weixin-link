import {memoryCommand} from '../../base/codex/native-memory.mjs'

export function controlCommand(text) {
  const command=text.trim()
  let match
  if(command==='长任务')return {action:'prompt',target:'goal'}
  if(command==='长任务状态')return {action:'goal',op:'get'}
  if(command==='暂停长任务')return {action:'goal',op:'pause'}
  if(command==='继续长任务')return {action:'goal',op:'resume'}
  if(command==='完成长任务')return {action:'goal',op:'complete'}
  if(command==='清除长任务')return {action:'goal',op:'clear'}
  if(command==='计划')return {action:'prompt',target:'plan'}
  if(command==='代码审查')return {action:'review',target:{type:'uncommittedChanges'}}
  if((match=command.match(/^代码审查[\s：:]+对比[\s：:]+([A-Za-z0-9._/-]{1,120})$/)))return {action:'review',target:{type:'baseBranch',branch:match[1]}}
  if((match=command.match(/^代码审查[\s：:]+提交[\s：:]+([a-f\d]{7,40})$/i)))return {action:'review',target:{type:'commit',sha:match[1]}}
  if(command==='压缩上下文')return {action:'compact'}
  if(command==='分叉会话')return {action:'fork',switchTo:true}
  if(command==='旁支会话')return {action:'fork',switchTo:false}
  if(command==='会话状态')return {action:'agentStatus'}
  if(command==='开启快速模式')return {action:'fast',enabled:true}
  if(command==='关闭快速模式')return {action:'fast',enabled:false}
  if(command==='补充')return {action:'prompt',target:'steer'}
  const chinese={停止:'stop',结果:'result',恢复:'recover',退出:'exit',模型:'models',状态:'status',进度:'progress',命令列表:'help'}
  const alias=text.trim().replace(/[。？！!?]$/,'')
  if(alias==='记忆')return {action:'memory',op:'list'}
  if(chinese[alias])return {action:chinese[alias]}
  const memory = memoryCommand(text)
  if(memory)return memory
  if(text.trim()==='会话列表')return {action:'sessions'}
  const resume=text.trim().match(/^恢复会话(?:\s+([A-Za-z0-9-]+))?$/i)
  if(resume)return {action:'resume',selection:resume[1]}
  if(text.trim()==='重置会话')return {action:'new'}
  const decision = text.match(/^(批准|拒绝)\s+([a-f\d]{6})$/i)
  if (decision) return { action: 'approval', accept: decision[1] === '批准', code: decision[2].toLowerCase() }
  const answer = text.match(/^回答\s+([a-f\d]{6})\s+([\s\S]+)$/i)
  if (answer) return { action: 'answer', code: answer[1].toLowerCase(), text: answer[2] }
  return null
}

export function completeControlPrompt(target,text){
 const value=text.trim()
 if(!value)return {error:'请输入内容。'}
 if(target==='steer')return value.length<=12000?{command:{action:'steer',text:value}}:{error:'补充内容不能超过12000字。'}
 if(target==='plan')return value.length<=12000?{command:{action:'plan',text:value}}:{error:'计划需求不能超过12000字。'}
 if(target==='goal'){
  const match=value.match(/^([\s\S]{1,1900}?)\s*\|\s*预算[\s：:]+(\d+)$/)
  if(match){const tokenBudget=Number(match[2]),objective=match[1].trim();return objective&&match[2].length<=9&&tokenBudget>0?{command:{action:'goal',op:'create',objective,tokenBudget}}:{error:'长任务目标不能为空，预算须为最多9位的正整数。'}}
  return value.length<=2000?{command:{action:'goal',op:'create',objective:value}}:{error:'长任务目标不能超过2000字。'}
 }
 return {error:'未知命令。'}
}
