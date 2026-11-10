import {workspaceText} from './workspace.mjs'
import {installOfficialHooks,titleUpdated,withBackend,officialCatalog,applyCatalog,refreshTitles} from './catalog.mjs'
import {label,serialize,flush,deliver,replay} from './delivery.mjs'
import {rename,selectConversation,archive,markDeleted,deleteConversation} from './operations.mjs'
import {history} from './history.mjs'
import {randomUUID} from 'node:crypto'
import {defineConversationBackendPort} from '../ports/conversation-backend-port.mjs'
export {historyText} from './history.mjs'
export class TextConversations{
 constructor(manager,owners,parseInput,backendPort){if(typeof parseInput!=='function')throw Error('CONVERSATION_INPUT_PARSER_REQUIRED');this.parseInput=parseInput;this.backendPort=backendPort?defineConversationBackendPort(backendPort):null;this.manager=manager;this.realOwners=new Set(owners);manager.state.textConversations??={};this.root=manager.state.textConversations;this.pages=new Map();for(const owner of owners)this.ensure(owner);manager.onConversationTitle=(threadId,name)=>this.titleUpdated(threadId,name);if(this.backendPort?.capabilities.catalog!==false)this.installOfficialHooks()}
 installOfficialHooks(...args){return installOfficialHooks(this,...args)}
 ensure(owner){if(!this.realOwners.has(owner))throw Error('未授权用户');if(!this.root[owner]){const saved=this.manager.state.users[owner]??{};const entries=[{id:'1',key:owner,name:'原有对话'}];for(const tid of [...new Set(saved.previous??[])].filter(t=>t!==saved.threadId)){const key=owner+'#conversation#'+randomUUID();entries.push({id:String(entries.length+1),key,name:'历史对话 '+(entries.length+1)});this.manager.state.users[key]={threadId:tid,hasMessages:true};}this.root[owner]={active:'1',entries};}const r=this.root[owner];if(!Object.hasOwn(r,'dailyId'))r.dailyId=(r.entries.find(e=>e.key===owner&&!e.deleted)??r.entries.find(e=>e.id===r.active&&!e.deleted)??r.entries.find(e=>!e.deleted))?.id??null;for(const e of this.root[owner].entries)this.manager.owners.add(e.key);return this.root[owner]}
 entry(key){for(const [owner,r]of Object.entries(this.root)){const entry=r.entries.find(e=>e.key===key);if(entry)return {...entry,owner};}return null}
 recipient(key){return this.entry(key)?.owner??key}
 find(owner,id){const r=this.ensure(owner);return id?r.entries.find(e=>e.id.toLowerCase()===id.toLowerCase()||this.manager.state.users[e.key]?.threadId===id):r.entries.find(e=>e.id===r.active)}
 // Called synchronously at message arrival, before any asynchronous work or download.
 bind(message){const owner=message.userId,r=this.ensure(owner),media=message.images?.length||message.files?.length||message.videos?.length||message.voices?.length,waiting=media?null:r.prompt,parsed=this.parseInput(message.text,{pending:waiting}),command=media?null:parsed.command;let error;const priorActive=r.active;
 const messageId=message.raw?.message_id??message.raw?.client_id;r.bindings??={};const prior=messageId===undefined?null:r.bindings[String(messageId)];if(prior){const saved=typeof prior==='string'?{key:prior}:prior;return {...message,userId:saved.key,_conversationOwner:owner,_conversationCommand:Object.hasOwn(saved,'command')?saved.command:command,_sessionCommand:Object.hasOwn(saved,'sessionCommand')?saved.sessionCommand:parsed.sessionCommand};}
 if(parsed.promptResult==='done')delete r.prompt;
 if(command?.action==='prompt')r.prompt={target:command.target,key:this.find(owner)?.key,id:this.find(owner)?.id};
 if(['new','switch','daily'].includes(command?.action))r.selectionVersion=(r.selectionVersion??0)+1;
 if(command?.action==='new'){const e={id:String(r.entries.length+1),key:owner+'#conversation#'+randomUUID(),name:'未命名项目 '+(r.entries.length+1),titleSource:'placeholder'};r.entries.push(e);r.active=e.id;this.manager.owners.add(e.key);}
 if(command?.action==='daily'){
  let home=r.entries.find(e=>e.id===r.dailyId);
  if(!home||home.deleted){home={id:String(r.entries.length+1),key:owner+'#conversation#'+randomUUID(),name:'日常助手',titleSource:'placeholder'};r.entries.push(home);r.dailyId=home.id;this.manager.owners.add(home.key);command.name='日常助手';}
  command.id=home.id;
  if(home.archived)error=`日常助手会话${home.id}已归档，发送“还原${home.id}”后再发“日常”。`;
  else if(home.deleteIntent||home.archiveSync==='missing')error='日常助手会话状态待核对，请先发“列表”；未新建替代会话。';
  else r.active=home.id;
 }
 if(command?.action==='switch'){const e=this.find(owner,command.id);if(e&&!e.archived)r.active=e.id;else error='会话不存在或已归档，请先发“列表”。';}
 let e=this.find(owner);if(waiting&&command?.action!=='new'){const target=r.entries.find(entry=>entry.key===waiting.key&&!entry.deleted);if(target)e=target;else{error='原会话已不可用，请重新发送命令。';}}
 if(parsed.questionCode){const q=this.manager.questions.get(parsed.questionCode);if(q&&this.recipient(q.session.userId)===owner)e=this.entry(q.session.userId);}
 if(messageId!==undefined){r.bindings[String(messageId)]={key:e.key,command:command??null,sessionCommand:parsed.sessionCommand??null};const ids=Object.keys(r.bindings);if(ids.length>200)delete r.bindings[ids[0]];}
 return {...message,userId:e.key,_conversationOwner:owner,_conversationCommand:command,_sessionCommand:parsed.sessionCommand,_conversationError:error,_conversationPriorActive:priorActive,_conversationSelectionVersion:r.selectionVersion};}
 label(...args){return label(this,...args)}
 // Serialize by real recipient so replay always precedes later live output.
 serialize(...args){return serialize(this,...args)}
 async flush(...args){return flush(this,...args)}
 deliver(...args){return deliver(this,...args)}
 replay(...args){return replay(this,...args)}
 titleUpdated(...args){return titleUpdated(this,...args)}
 async rename(...args){return rename(this,...args)}
 // Catalog reconciliation is used only when the backend has an authoritative catalog.
 async withBackend(...args){return withBackend(this,...args)}
 async officialCatalog(...args){return officialCatalog(this,...args)}
 applyCatalog(...args){return applyCatalog(this,...args)}
 async refreshTitles(...args){return refreshTitles(this,...args)}
 async listProjects(owner,reply){
  if(this.backendPort?.capabilities.catalog!==false)await this.refreshTitles(owner)
  const r=this.ensure(owner),local=this.backendPort?.capabilities.catalog===false
  const lines=r.entries.filter(e=>e.id!==r.dailyId&&!e.archived&&!e.deleted).map(e=>{
   const session=this.manager.sessions.get(e.key),current=e.id===r.active?' [当前]':''
   if(local)return `${e.id}. ${e.name}${current}${session?.busy?' · 执行中':''}`
   const recovery=this.manager.state.users[e.key]?.recovery?.execution
   const status=session?.busy||e.officialStatus==='active'?'执行中':session?.finishing?'发送中':e.deleteIntent?'删除状态待核对':e.archiveSync==='missing'?'Codex记录缺失':e.archiveIntent!==undefined?'归档状态待核对':recovery==='unknown'?'结果待核对':!this.manager.state.users[e.key]?.threadId?'尚未连接Codex':'空闲'
   return `${e.id}. ${e.name}${current} · ${status}`
  })
  const help=local?'新建（按提示输入项目名）｜切换编号｜日常。当前底座暂不支持项目归档、永久删除和历史检索。':'新建｜切换编号｜命名｜历史｜归档编号｜还原编号｜删除编号（永久删除，含派生子会话）\n日常对话独立保留，发“日常”进入；停止只影响当前对话。'
  await reply('项目列表\n'+(lines.length?lines.join('\n'):'暂无项目')+'\n'+help)
 }
 async control(message,reply){
  const cmd=message._conversationCommand
  if(!cmd)return false
  const originalReply=reply
  reply=(value,options)=>originalReply(value,{...options,conversationControl:true})
  await this.manager.save()
  const owner=message._conversationOwner
  if(cmd.action==='switch'&&this.find(owner,cmd.id))delete message._conversationError
  if(message._conversationError){await reply(message._conversationError);return true}
  if(cmd.action==='prompt'){const prompts={steer:'请输入要补充的信息。',plan:'请输入计划需求。',goal:'请输入长任务目标；可在末尾加“| 预算 10000”。',new:'请输入项目名称。',newProject:'请回复“项目名 | 绝对目录”。',rename:'请输入新的会话名称。',search:'请输入搜索词。'};await reply(`${prompts[cmd.target]}下一条纯文字将作为输入；发送“取消”放弃。`);return true}
  if(cmd.action==='promptInvalid'){await reply(`${cmd.text}请重新输入，或发送“取消”放弃。`);return true}
  if(cmd.action==='promptCancel'){await reply('已取消输入。');return true}
  const e=this.find(owner,cmd.id)
  if(cmd.action==='workspace')await reply(`当前项目：${this.find(owner)?.name??'日常'}\n目录：${workspaceText(this,message.userId)}\n底座：${this.manager.agentName??'Codex'}\n目录是执行起点，不是操作系统隔离边界。`)
  else if(cmd.action==='list')await this.listProjects(owner,reply)
  else if(cmd.action==='delete'&&this.backendPort?.capabilities.delete)await this.deleteConversation(owner,e,reply)
  else if((cmd.action==='archive'||cmd.action==='unarchive')&&this.backendPort?.capabilities.archive)await this.archive(owner,e,cmd.action==='archive',reply)
  else if(cmd.action==='rename'){
   const current=this.find(owner,cmd.id)
   await this.rename(current,cmd.name,reply)
   await reply(this.backendPort?.capabilities.remoteRename?`会话${current.id}的Codex标题已更新为：${current.name}。`:`已命名会话${current.id}：${current.name}。`)
  }
  else if(['new','switch','daily'].includes(cmd.action))await this.selectConversation(message,reply)
  else if(['delete','archive','unarchive','history','older','search'].includes(cmd.action)&&this.backendPort?.capabilities.catalog===false)await reply('当前底座暂不支持该会话操作；未修改会话或历史。')
  else{
   if(!e&&cmd.action!=='older'){await reply('会话不存在。');return true}
   await this.history(owner,e,cmd,reply)
  }
  return true
 }
 async selectConversation(...args){return selectConversation(this,...args)}
 async archive(...args){return archive(this,...args)}
 markDeleted(...args){return markDeleted(this,...args)}
 async deleteConversation(...args){return deleteConversation(this,...args)}
 async history(...args){return history(this,...args)}
}
