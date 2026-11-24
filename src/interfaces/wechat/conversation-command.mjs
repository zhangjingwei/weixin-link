import {isCatalogQuestion,isResultLookup} from '../../application/intake/catalog-question.mjs'
import {controlCommand,completeControlPrompt} from './control-command.mjs'

// Information requests can be answered without consuming the text prompt.
const promptInfoCommands=new Set([
 '使用说明','guide','安装帮助','install-help','服务状态','service-status',
])
const promptInfoActions=new Set(['help','progress','agentStatus','models'])

export function conversationCommand(text=''){
 return null;
}

/** Parse transport text once, before conversation binding or intent routing. */
export function conversationInput(text='',{pending}={}){
 const input=typeof text==='string'?text:''
 const value=input.trim()
 if(pending){
  if(value==='取消'||value.toLowerCase()==='cancel')return {command:{action:'promptCancel'},promptResult:'done'}
  if(['stop','exit','停止','退出','关闭'].includes(value.toLowerCase()))return {sessionCommand:controlCommand(value),promptResult:'done'}
  const info=controlCommand(input)
  if(info&&(promptInfoActions.has(info.action)||info.action==='goal'&&info.op==='get'||info.action==='memory'&&info.op==='list'))return {sessionCommand:info,promptResult:'keep'}
  if(/^(?:状态|status)[。？！!?]?$/iu.test(value)||isResultLookup(value)||promptInfoCommands.has(value.toLowerCase()))return {command:null,promptResult:'keep'}
  const navigation=conversationCommand(input)
  if(isCatalogQuestion(input) && ['switch','history','archive','unarchive','delete','projectFolder','approvalChoice'].includes(pending.target))return {command:null,promptResult:'keep'}
  if(navigation?.action==='prompt'&&['switch','history','archive','unarchive','delete'].includes(navigation.target))return {command:navigation,promptResult:'done'}
  if(navigation&&['switch','archive','unarchive','delete'].includes(navigation.action))return {command:navigation,promptResult:'done'}
  const approval=controlCommand(input)
  if(approval?.action==='prompt'&&approval.target==='approvalChoice')return {command:approval,promptResult:'done'}
  if(!value)return {command:{action:'promptInvalid',text:'请输入文字。'},promptResult:'retry'}
  let result
  if(pending.target==='personalResume'){
   if(navigation)return {command:navigation,promptResult:'done'}
   const choices=pending.choices??[]
   const ordinal=value.match(/^第([一二三四五1-5])(?:条|个)$/u)?.[1]
   const number=ordinal?('一二三四五'.indexOf(ordinal)+1||Number(ordinal)):Number(value)
   const match=Number.isInteger(number)&&number>0?choices[number-1]:choices.filter(c=>c.name===value||c.folder===value)
   const choice=Array.isArray(match)?(match.length===1?match[0]:null):match
   result=choice?{command:{action:'personalResume',threadId:choice.id}}:{error:'请告诉我是上面哪一条，可以回复标题或序号。'}
  }
  else if(pending.target==='switch'){
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
