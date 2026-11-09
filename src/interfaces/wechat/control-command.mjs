import {memoryCommand} from '../../base/codex/native-memory.mjs'

export function controlCommand(text) {
  const command=text.trim()
  let match
  if((match=command.match(/^长任务[\s：:]+([\s\S]{1,1900}?)\s*\|\s*预算[\s：:]+(\d+)$/))){const tokenBudget=Number(match[2]);return match[2].length<=9&&tokenBudget>0?{action:'goal',op:'create',objective:match[1].trim(),tokenBudget}:{action:'goal',op:'invalidBudget'}}
  if((match=command.match(/^长任务[\s：:]+([\s\S]{1,2000})$/)))return {action:'goal',op:'create',objective:match[1].trim()}
  if(command==='长任务状态')return {action:'goal',op:'get'}
  if(command==='暂停长任务')return {action:'goal',op:'pause'}
  if(command==='继续长任务')return {action:'goal',op:'resume'}
  if(command==='完成长任务')return {action:'goal',op:'complete'}
  if(command==='清除长任务')return {action:'goal',op:'clear'}
  if((match=command.match(/^计划[\s：:]+([\s\S]{1,12000})$/)))return {action:'plan',text:match[1].trim()}
  if(command==='代码审查')return {action:'review',target:{type:'uncommittedChanges'}}
  if((match=command.match(/^代码审查[\s：:]+对比[\s：:]+([A-Za-z0-9._/-]{1,120})$/)))return {action:'review',target:{type:'baseBranch',branch:match[1]}}
  if((match=command.match(/^代码审查[\s：:]+提交[\s：:]+([a-f\d]{7,40})$/i)))return {action:'review',target:{type:'commit',sha:match[1]}}
  if(command==='压缩上下文')return {action:'compact'}
  if(command==='分叉会话')return {action:'fork',switchTo:true}
  if(command==='旁支会话')return {action:'fork',switchTo:false}
  if(command==='Codex状态')return {action:'agentStatus'}
  if(command==='开启快速模式')return {action:'fast',enabled:true}
  if(command==='关闭快速模式')return {action:'fast',enabled:false}
  const steer=text.trim().match(/^补充(?:[\s：:]+([\s\S]*))?$/)
  if(steer)return {action:'steer',text:(steer[1]??'').trim()}
  const chinese={停止:'stop',结果:'result',恢复:'recover',退出:'exit',模型:'models',状态:'status',任务状态:'status',进度:'progress',任务进度:'progress',进度如何了:'progress',现在到哪一步了:'progress',停止任务:'stop',查看结果:'result',重看结果:'result',恢复任务:'recover',核对任务:'recover',退出会话:'exit',帮助:'help',命令列表:'help',控制命令:'help'}
  const alias=text.trim().replace(/[。？！!?]$/,'')
  if(alias==='记忆')return {action:'memory',op:'list'}
  if(chinese[alias])return {action:chinese[alias]}
  const memory = memoryCommand(text)
  if(memory)return memory
  if(text.trim()==='Codex会话列表')return {action:'sessions'}
  const resume=text.trim().match(/^恢复Codex会话(?:\s+([A-Za-z0-9-]+))?$/i)
  if(resume)return {action:'resume',selection:resume[1]}
  if(text.trim()==='重置Codex会话')return {action:'new'}
  if (/^(?:停止|中断)(?:当前)?任务[。！!，,]?$/.test(text)) return { action: 'stop' }
  if (/^(?:退出|停止|关闭|结束)\s*codex[。！!，,]?$/i.test(text) || text === '退出当前对话') return { action: 'exit' }
  const decision = text.match(/^(批准|拒绝)\s+([a-f\d]{6})$/i)
  if (decision) return { action: 'approval', accept: decision[1] === '批准', code: decision[2].toLowerCase() }
  const answer = text.match(/^回答\s+([a-f\d]{6})\s+([\s\S]+)$/i)
  if (answer) return { action: 'answer', code: answer[1].toLowerCase(), text: answer[2] }
  return null
}
