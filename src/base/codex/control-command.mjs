import {memoryCommand} from './native-memory.mjs'

export function controlCommand(text) {
  const steer=text.trim().match(/^补充(?:[\s：:]+([\s\S]*))?$/)
  if(steer)return {action:'steer',text:(steer[1]??'').trim()}
  const chinese={停止:'stop',结果:'result',恢复:'recover',退出:'exit',模型:'models',状态:'status',任务状态:'status',停止任务:'stop',查看结果:'result',重看结果:'result',恢复任务:'recover',核对任务:'recover',退出会话:'exit',帮助:'help'}
  const alias=text.trim().replace(/^\//,'').replace(/[。！!]$/,'')
  if(alias==='记忆')return {action:'memory',op:'list'}
  if(chinese[alias])return {action:chinese[alias]}
  const memory = memoryCommand(text)
  if(memory)return memory
  if(/^\/sessions$/i.test(text.trim()))return {action:'sessions'}
  const resume=text.trim().match(/^\/resume(?:\s+([A-Za-z0-9-]+))?$/i)
  if(resume)return {action:'resume',selection:resume[1]}
  const command = text.trim().match(/^\/(?:codex\s+)?(status|stop|exit|reset|new|result|recover|help|models)$/i)
  if (command) return {action:command[1].toLowerCase()}
  if (/^(?:停止|中断)(?:当前)?任务[。！!，,]?$/.test(text)) return { action: 'stop' }
  if (/^(?:退出|停止|关闭|结束)\s*codex[。！!，,]?$/i.test(text) || text === '退出当前对话') return { action: 'exit' }
  const decision = text.match(/^\/?(批准|拒绝)\s+([a-f\d]{6})$/i)
  if (decision) return { action: 'approval', accept: decision[1] === '批准', code: decision[2].toLowerCase() }
  const answer = text.match(/^\/?回答\s+([a-f\d]{6})\s+([\s\S]+)$/i)
  if (answer) return { action: 'answer', code: answer[1].toLowerCase(), text: answer[2] }
  return null
}
