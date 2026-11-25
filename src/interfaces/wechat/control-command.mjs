// Approval choices remain explicit user actions, separate from agent management.
export function controlCommand(text) {
  const command=text.trim().toLowerCase()
  const decision=({批准:'approve',拒绝:'reject',回答:'answer',approve:'approve',reject:'reject',answer:'answer'})[command]
  return typeof decision==='string'?{action:'prompt',target:'approvalChoice',decision}:recoveryControlCommand(text)
}

// Only recovery controls are interpreted before the model sees a new message.
export function recoveryControlCommand(text) {
  const value=text.trim().toLowerCase().replace(/[。？！!?]$/u,'')
  if(value==='stop'||value==='停止')return {action:'stop'}
  if(value==='exit'||value==='退出')return {action:'exit'}
  return null
}

export function completeControlPrompt(target,text){
 const value=text.trim()
 if(!value)return {error:'请输入内容。'}
 if(target==='steer')return value.length<=12000?{command:{action:'steer',text:value}}:{error:'补充内容不能超过12000字。'}
 if(target==='resume')return /^\d{1,3}$/.test(value)&&Number(value)>0?{command:{action:'resume',selection:value}}:{error:'请回复列表中的编号。'}
 return {error:'未知命令。'}
}
