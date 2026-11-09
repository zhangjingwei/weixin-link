import {bindNewWorkspace,workspaceText} from '../../application/conversations/workspace.mjs'
import {TextConversations} from '../../application/conversations/text-conversations.mjs'

// Claude's CLI has no Codex-style catalog/archive/delete RPC. Keep navigation
// account scoped, and never report a local operation as a remote deletion.
export class ClaudeConversations extends TextConversations{
 installOfficialHooks(){}
 async control(message,reply){
  const cmd=message._conversationCommand
  if(!cmd)return false
  reply=(send=>value=>send(value,{conversationControl:true}))(reply)
  const owner=message._conversationOwner,r=this.ensure(owner),entry=this.find(owner,cmd.id)
  if(message._conversationError){await reply(message._conversationError);return true}
  if(cmd.action==='workspace')return super.control(message,reply)
  if(cmd.action==='list'){
   const projects=r.entries.filter(e=>e.id!==r.dailyId&&!e.archived&&!e.deleted).map(e=>`${e.id}. ${e.name}${e.id===r.active?' [当前]':''}${this.manager.sessions.get(e.key)?.busy?' · 执行中':''}`)
   await reply('项目列表\n'+(projects.length?projects.join('\n'):'暂无项目')+'\n新建 项目名｜切换编号｜日常。Claude 暂不支持项目归档、永久删除和历史检索。')
  }else if(['new','switch','daily'].includes(cmd.action)){
   const current=cmd.action==='switch'?entry:r.entries.find(e=>e.key===message.userId)
   if(!current||current.archived||current.deleted){await reply('会话不存在或已归档。');return true}
   await bindNewWorkspace(this,current.key,cmd.workspace)
   await this.manager.connect(current.key,this.manager.sessions.get(current.key)?.reply??reply)
   if(cmd.name)current.name=cmd.name.slice(0,60)
   if(r.selectionVersion===message._conversationSelectionVersion)r.active=current.id
   await this.manager.save()
   await reply(`已切换到 Claude 会话${current.id}：${current.name}。目录：${workspaceText(this,current.key)}。`)
   if(this.sendOutput)await this.replay(current.key,this.sendOutput)
  }else if(cmd.action==='rename'){
   const current=this.find(owner);current.name=cmd.name.slice(0,60);await this.manager.save();await reply(`已命名会话${current.id}：${current.name}。`)
  }else await reply('Claude 底座暂不支持该会话操作；未修改会话或历史。')
  return true
 }
}
