import {installOfficialHooks,titleUpdated,withCatalogRpc,officialCatalog,applyCatalog,refreshTitles} from './conversations/catalog.mjs'
import {label,serialize,flush,deliver,replay} from './conversations/delivery.mjs'
import {rename,selectOfficial,archive,markDeleted,deleteConversation} from './conversations/operations.mjs'
import {history} from './conversations/history.mjs'
import {randomUUID} from 'node:crypto'
import {conversationCommand} from './conversations/commands.mjs'
export {conversationCommand} from './conversations/commands.mjs'
export {historyText} from './conversations/history.mjs'
export class TextConversations{
 constructor(manager,owners){this.manager=manager;this.realOwners=new Set(owners);manager.state.textConversations??={};this.root=manager.state.textConversations;this.pages=new Map();for(const owner of owners)this.ensure(owner);manager.onConversationTitle=(threadId,name)=>this.titleUpdated(threadId,name);this.installOfficialHooks()}
 installOfficialHooks(...args){return installOfficialHooks(this,...args)}
 ensure(owner){if(!this.realOwners.has(owner))throw Error('未授权用户');if(!this.root[owner]){const saved=this.manager.state.users[owner]??{};const entries=[{id:'1',key:owner,name:'原有对话'}];for(const tid of [...new Set(saved.previous??[])].filter(t=>t!==saved.threadId)){const key=owner+'#conversation#'+randomUUID();entries.push({id:String(entries.length+1),key,name:'历史对话 '+(entries.length+1)});this.manager.state.users[key]={threadId:tid,hasMessages:true};}this.root[owner]={active:'1',entries};}for(const e of this.root[owner].entries)this.manager.owners.add(e.key);return this.root[owner]}
 entry(key){for(const [owner,r]of Object.entries(this.root)){const entry=r.entries.find(e=>e.key===key);if(entry)return {...entry,owner};}return null}
 recipient(key){return this.entry(key)?.owner??key}
 find(owner,id){const r=this.ensure(owner);return id?r.entries.find(e=>e.id.toLowerCase()===id.toLowerCase()||this.manager.state.users[e.key]?.threadId===id):r.entries.find(e=>e.id===r.active)}
 // Called synchronously at message arrival, before any asynchronous work or download.
 bind(message){const owner=message.userId,r=this.ensure(owner),command=(message.images?.length||message.files?.length||message.videos?.length||message.voices?.length)?null:conversationCommand(message.text);let error;const priorActive=r.active;
 const messageId=message.raw?.message_id??message.raw?.client_id;r.bindings??={};const prior=messageId===undefined?null:r.bindings[String(messageId)];if(prior)return {...message,userId:prior,_conversationOwner:owner,_conversationCommand:command};
 if(command?.action==='new'||command?.action==='switch')r.selectionVersion=(r.selectionVersion??0)+1;
 if(command?.action==='new'){const e={id:String(r.entries.length+1),key:owner+'#conversation#'+randomUUID(),name:'未命名对话 '+(r.entries.length+1),titleSource:'placeholder'};r.entries.push(e);r.active=e.id;this.manager.owners.add(e.key);}
 if(command?.action==='switch'){const e=this.find(owner,command.id);if(e&&!e.archived)r.active=e.id;else error='会话不存在或已归档，请先发“列表”。';}
 let e=this.find(owner);const decision=message.text?.trim().match(/^\/?(?:批准|拒绝|回答)\s+([a-f\d]{6})\b/i);if(decision){const q=this.manager.questions.get(decision[1]);if(q&&this.recipient(q.session.userId)===owner)e=this.entry(q.session.userId);}
 if(messageId!==undefined){r.bindings[String(messageId)]=e.key;const ids=Object.keys(r.bindings);if(ids.length>200)delete r.bindings[ids[0]];}
 return {...message,userId:e.key,_conversationOwner:owner,_conversationCommand:command,_conversationError:error,_conversationPriorActive:priorActive,_conversationSelectionVersion:r.selectionVersion};}
 label(...args){return label(this,...args)}
 // Serialize by real recipient so replay always precedes later live output.
 serialize(...args){return serialize(this,...args)}
 async flush(...args){return flush(this,...args)}
 deliver(...args){return deliver(this,...args)}
 replay(...args){return replay(this,...args)}
 titleUpdated(...args){return titleUpdated(this,...args)}
 async rename(...args){return rename(this,...args)}
 // Codex is authoritative for persisted threads. Local archived is only a verified cache.
 async withCatalogRpc(...args){return withCatalogRpc(this,...args)}
 async officialCatalog(...args){return officialCatalog(this,...args)}
 applyCatalog(...args){return applyCatalog(this,...args)}
 async refreshTitles(...args){return refreshTitles(this,...args)}
 async control(message,reply){const cmd=message._conversationCommand;if(!cmd)return false;const originalReply=reply;reply=(value,options)=>originalReply(value,{...options,conversationControl:true});await this.manager.save();const owner=message._conversationOwner;if(cmd.action==='switch'&&this.find(owner,cmd.id))delete message._conversationError;if(message._conversationError){await reply(message._conversationError);return true;}
 const r=this.ensure(owner),e=this.find(owner,cmd.id);if(cmd.action==='list'){await this.refreshTitles(owner,reply);const lines=r.entries.filter(e=>!e.archived&&!e.deleted).map(e=>{const s=this.manager.sessions.get(e.key),state=this.manager.state.users[e.key]?.recovery?.execution;return `${e.id}. ${e.name}${e.id===r.active?' [当前]':''} · ${s?.busy||e.officialStatus==='active'?'执行中':s?.finishing?'发送中':e.deleteIntent?'删除状态待核对':e.archiveSync==='missing'?'Codex记录缺失':e.archiveIntent!==undefined?'归档状态待核对':state==='unknown'?'结果待核对':!this.manager.state.users[e.key]?.threadId?'尚未连接Codex':'空闲'}`});await reply('会话列表\n'+lines.join('\n')+'\n切换2｜新建 名称｜命名 名称｜历史｜历史2｜翻页｜搜索 关键词｜归档2｜还原2｜删除2（永久删除，含派生子会话，不可还原）\n停止 只停止当前会话，切换不会停止其他任务。');}
 else if(cmd.action==='delete'){await this.deleteConversation(owner,e,reply);}
 else if(cmd.action==='archive'||cmd.action==='unarchive'){await this.archive(owner,e,cmd.action==='archive',reply);}
 else if(cmd.action==='rename'){const current=this.find(owner);await this.rename(current,cmd.name,reply);await reply(`会话${current.id}的Codex标题已更新为：${current.name}。`);}
 else if(cmd.action==='new'||cmd.action==='switch'){await this.selectOfficial(message,reply);}
 else{if(!e&&cmd.action!=='older'){await reply('会话不存在。');return true;}await this.history(owner,e,cmd,reply);}return true;}
 async selectOfficial(...args){return selectOfficial(this,...args)}
 async archive(...args){return archive(this,...args)}
 markDeleted(...args){return markDeleted(this,...args)}
 async deleteConversation(...args){return deleteConversation(this,...args)}
 async history(...args){return history(this,...args)}
}
