import {controlCommand,completeControlPrompt} from './control-command.mjs'

const english={
 'new-project':'新建项目',folder:'当前目录',daily:'日常',list:'列表',new:'新建',switch:'切换',archive:'归档',restore:'还原',delete:'删除',
 history:'历史',rename:'命名',older:'翻页',search:'搜索',
}

// Information requests can be answered without consuming the text prompt.
const promptInfoCommands=new Set([
 '检查更新','check-updates','使用说明','guide','安装状态','setup-status','安装帮助','install-help',
 '诊断','diagnose','服务状态','service-status','查看最近错误','recent-errors',
])
const promptInfoActions=new Set(['help','status','progress','result','agentStatus','models'])

export function conversationCommand(text=''){
 const raw=text.trim(),s=english[raw.toLowerCase()]??raw;let m;
 if(s==='新建项目')return {action:'prompt',target:'newProject'};
 if(s==='当前目录')return {action:'workspace'};
 if(s==='日常')return {action:'daily'};
 if(s==='列表')return {action:'list'};
 if(s==='新建')return {action:'prompt',target:'new'};
 if(s==='切换')return {action:'prompt',target:'switch'};
 if(s==='历史')return {action:'prompt',target:'history'};
 if(s==='命名')return {action:'prompt',target:'rename'};
 if(s==='归档')return {action:'prompt',target:'archive'};
 if(s==='还原')return {action:'prompt',target:'unarchive'};
 if(s==='删除')return {action:'prompt',target:'delete'};
 if((m=s.match(/^(归档|删除|还原)\s*(\d+)$/)))return {action:m[1]==='还原'?'unarchive':m[1]==='删除'?'delete':'archive',id:m[2]};
 if((m=raw.match(/^(archive|delete|restore)(\d+)$/i)))return {action:m[1].toLowerCase()==='restore'?'unarchive':m[1].toLowerCase(),id:m[2]};
 if(s==='翻页')return {action:'older'};
 if(s==='搜索')return {action:'prompt',target:'search'};
 return null;
}

/** Parse transport text once, before conversation binding or intent routing. */
export function conversationInput(text='',{pending}={}){
 const input=typeof text==='string'?text:''
 const value=input.trim()
 if(pending){
  if(value==='取消'||value.toLowerCase()==='cancel')return {command:{action:'promptCancel'},promptResult:'done'}
  if(['stop','exit','停止','退出'].includes(value.toLowerCase()))return {sessionCommand:controlCommand(value),promptResult:'done'}
  const info=controlCommand(input)
  if(info&&(promptInfoActions.has(info.action)||info.action==='goal'&&info.op==='get'||info.action==='memory'&&info.op==='list'))return {sessionCommand:info,promptResult:'keep'}
  if(promptInfoCommands.has(value.toLowerCase()))return {command:null,promptResult:'keep'}
  const navigation=conversationCommand(input)
  if(navigation?.action==='prompt'&&['switch','history','archive','unarchive','delete'].includes(navigation.target))return {command:navigation,promptResult:'done'}
  if(navigation&&['switch','archive','unarchive','delete'].includes(navigation.action))return {command:navigation,promptResult:'done'}
  const approval=controlCommand(input)
  if(approval?.action==='prompt'&&approval.target==='approvalChoice')return {command:approval,promptResult:'done'}
  if(!value)return {command:{action:'promptInvalid',text:'请输入文字。'},promptResult:'retry'}
  let result
  if(pending.target==='switch'){
   const id=/^[1-9]\d*$/.test(value)?pending.choices?.[Number(value)-1]:null
   result=id?{command:{action:'switch',id}}:{error:'请回复列表中的编号。'}
  }
  else if(pending.target==='history'){
   const id=/^[1-9]\d*$/.test(value)?pending.choices?.[Number(value)-1]:null
   result=id?{command:{action:'history',id}}:{error:'请回复列表中的编号。'}
  }
  else if(['archive','unarchive','delete'].includes(pending.target)){
   const id=/^[1-9]\d*$/.test(value)?pending.choices?.[Number(value)-1]:null
   result=id?{command:{action:pending.target,id}}:{error:'请回复列表中的编号。'}
  }
  else if(pending.target==='approvalChoice'){
   const selected=/^[1-9]\d*$/.test(value)?pending.choices?.[Number(value)-1]:null
   if(!selected)return {command:{action:'promptInvalid',text:'请回复列表中的编号。'},promptResult:'retry'}
   if(pending.decision==='answer')return {command:{action:'answerPrompt',code:selected.code},questionCode:selected.code,promptResult:'done'}
   return {sessionCommand:{action:'approval',accept:pending.decision==='approve',code:selected.code},questionCode:selected.code,promptResult:'done'}
  }
  else if(pending.target==='answerText')return {sessionCommand:{action:'answer',code:pending.code,text:value},questionCode:pending.code,promptResult:'done'}
  else if(pending.target==='new')result=value.length<=40?{command:{action:'new',name:value}}:{error:'项目名不能超过40字。'}
  else if(pending.target==='newProject')result=value.length<=40&&!/[\x00-\x1f\x7f|]/.test(value)?{command:{action:'projectFolderPrompt',name:value}}:{error:'请只输入项目名，不要填写路径；项目名最多40字。'}
  else if(pending.target==='projectFolder'){
   const folder=/^[1-9]\d*$/.test(value)?pending.choices?.[Number(value)-1]:null
   result=folder?{command:{action:'new',name:pending.name,workspace:folder.path}}:{error:'请回复文件夹列表中的编号。'}
  }
  else if(pending.target==='rename')result=value.length<=40?{command:{action:'rename',name:value,id:pending.id}}:{error:'名称不能超过40字。'}
  else if(pending.target==='search')result=value.length<=60?{command:{action:'search',q:value,id:pending.id}}:{error:'搜索词不能超过60字。'}
  else {const completed=completeControlPrompt(pending.target,value);result=completed.error?completed:{sessionCommand:completed.command}}
  return result.error?{command:{action:'promptInvalid',text:result.error},promptResult:'retry'}:{...result,promptResult:'done'}
 }
 const command=conversationCommand(input),control=command?null:controlCommand(input)
 return {command:command??(control?.action==='prompt'?control:null)}
}
