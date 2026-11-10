import {controlCommand,completeControlPrompt} from './control-command.mjs'

export function conversationCommand(text=''){
 const s=text.trim();let m;
 if(s==='新建项目')return {action:'prompt',target:'newProject'};
 if(s==='当前目录')return {action:'workspace'};
 if(s==='日常')return {action:'daily'};
 if(s==='列表')return {action:'list'};
 if(s==='新建')return {action:'prompt',target:'new'};
 if((m=s.match(/^切换\s*([A-Za-z0-9-]+)$/)))return {action:'switch',id:m[1]};
 if((m=s.match(/^历史(?:\s*([A-Za-z0-9-]+))?$/)))return {action:'history',id:m[1]};
 if(s==='命名')return {action:'prompt',target:'rename'};
 if((m=s.match(/^(归档|删除|还原)\s*(\d+)$/)))return {action:m[1]==='还原'?'unarchive':m[1]==='删除'?'delete':'archive',id:m[2]};
 if(s==='翻页')return {action:'older'};
 if(s==='搜索')return {action:'prompt',target:'search'};
 return null;
}

/** Parse transport text once, before conversation binding or intent routing. */
export function conversationInput(text='',{pending}={}){
 const input=typeof text==='string'?text:''
 const questionCode=input.trim().match(/^(?:批准|拒绝|回答)\s+([a-f\d]{6})\b/i)?.[1]
 const value=input.trim()
 if(pending){
  if(questionCode)return {command:null,questionCode}
  if(value==='取消')return {command:{action:'promptCancel'},promptResult:'done'}
  if(value==='停止'||value==='退出')return {sessionCommand:controlCommand(value),promptResult:'done'}
  const navigation=conversationCommand(input)
  if(navigation&&['switch','archive','unarchive','delete'].includes(navigation.action))return {command:navigation,promptResult:'done'}
  if(!value)return {command:{action:'promptInvalid',text:'请输入文字。'},promptResult:'retry'}
  let result
  if(pending.target==='new')result=value.length<=40?{command:{action:'new',name:value}}:{error:'项目名不能超过40字。'}
  else if(pending.target==='newProject'){
   const match=value.match(/^([^|\r\n]{1,40})\s*\|\s*(.+)$/)
   result=match&&match[1].trim()&&match[2].trim()?{command:{action:'new',name:match[1].trim(),workspace:match[2].trim()}}:{error:'请回复“项目名 | 绝对目录”。'}
  }
  else if(pending.target==='rename')result=value.length<=40?{command:{action:'rename',name:value,id:pending.id}}:{error:'名称不能超过40字。'}
  else if(pending.target==='search')result=value.length<=60?{command:{action:'search',q:value,id:pending.id}}:{error:'搜索词不能超过60字。'}
  else {const completed=completeControlPrompt(pending.target,value);result=completed.error?completed:{sessionCommand:completed.command}}
  return result.error?{command:{action:'promptInvalid',text:result.error},promptResult:'retry'}:{...result,promptResult:'done'}
 }
 const command=conversationCommand(input),control=command?null:controlCommand(input)
 return {command:command??(control?.action==='prompt'?control:null),questionCode}
}
