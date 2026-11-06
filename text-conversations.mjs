import {CodexRpc} from './codex-session.mjs'
import {randomUUID} from 'node:crypto'
export function conversationCommand(text=''){
 const s=text.trim();let m;
 if(/^(列表|会话列表|查看会话|\/sessions)$/i.test(s))return {action:'list'};
 if((m=s.match(/^(?:新建(?:会话)?|\/new|\/reset)(?:\s+(.{1,40}))?$/i)))return {action:'new',name:m[1]};
 if((m=s.match(/^(?:切换(?:会话)?|\/resume)\s*([A-Za-z0-9-]+)$/i)))return {action:'switch',id:m[1]};
 if((m=s.match(/^(?:历史|\/history)(?:\s*([A-Za-z0-9-]+))?$/i)))return {action:'history',id:m[1]};
 if((m=s.match(/^命名\s+(.{1,40})$/)))return {action:'rename',name:m[1]};
 if((m=s.match(/^(归档|删除|还原)\s*(\d+)$/)))return {action:m[1]==='还原'?'unarchive':m[1]==='删除'?'delete':'archive',id:m[2]};
 if(/^(翻页|上一页|历史上一页)$/.test(s))return {action:'older'};
 if((m=s.match(/^(?:搜索|搜索历史)\s+(.{1,60})$/)))return {action:'search',q:m[1]};
 return null;
}
export function historyText(value){return String(value).replace(/<wechat-memory:[^>]+>[\s\S]*?<\/wechat-memory:[^>]+>/g,'').replace(/<wechat-task:[^>]+>[\s\S]*?<\/wechat-task:[^>]+>/g,'').replace(/!?\[([^\]\n]*)\]\((?:<\/[^>\n]+>|\/[^\s)]+)\)/g,'$1〔历史附件，未重发〕').trim()}
export class TextConversations{
 constructor(manager,owners){this.manager=manager;this.realOwners=new Set(owners);manager.state.textConversations??={};this.root=manager.state.textConversations;this.pages=new Map();for(const owner of owners)this.ensure(owner);manager.onConversationTitle=(threadId,name)=>this.titleUpdated(threadId,name);this.installOfficialHooks()}
 installOfficialHooks(){
  this.manager.beforeConversationConnect=async key=>{
   if(this.archiveLocks?.has(key))throw Error('该会话正在更改归档状态，请稍后继续。');
   const e=this.entry(key),tid=this.manager.state.users[key]?.threadId;if(e?.deleted)throw Error('该会话已被Codex永久删除，不能继续或还原。');if(!e||!tid)return;
   await this.withCatalogRpc(e.owner,async rpc=>{const catalog=await this.officialCatalog(rpc,e.owner);this.applyCatalog(e.owner,catalog);await this.manager.save();const item=catalog.get(tid);if(!item)throw Error('Codex记录缺失，未自动新建替代会话。');if(item.archived)throw Error('Codex会话已归档，请先还原后继续。');});
  };
  this.manager.onConversationDelete=async threadId=>{this.markDeleted(threadId);await this.manager.save()};
  this.manager.onConversationArchive=async(threadId,archived)=>{
   for(const r of Object.values(this.root))for(const e of r.entries)if(this.manager.state.users[e.key]?.threadId===threadId){if(e.deleted)continue;e.archived=archived;e.archiveSync='confirmed';if(e.archiveIntent===archived)delete e.archiveIntent;}
   await this.manager.save();
  };
 }
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
 label(key,value){const e=this.entry(key);if(!e||this.root[e.owner].entries.length<2)return value;const prefix=`【会话${e.id} · ${e.name}】\n`;return typeof value==='string'?prefix+value:{...value,text:prefix+value.text};}
 // Serialize by real recipient so replay always precedes later live output.
 serialize(owner,fn){this.deliveryQueues??=new Map();const run=(this.deliveryQueues.get(owner)??Promise.resolve()).catch(()=>{}).then(fn);this.deliveryQueues.set(owner,run);return run.finally(()=>{if(this.deliveryQueues.get(owner)===run)this.deliveryQueues.delete(owner)})}
 async flush(key,send){const e=this.entry(key);if(!e)return;const saved=this.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];
 while(saved.unread.length&&this.find(e.owner)?.key===key){const item=saved.unread[0];if(item.state==='sending'||item.state==='unknown')break;item.state='sending';await this.manager.save();try{const result=await send(key,this.label(key,item.value),{checkpoint:()=>this.manager.save()});if(result?.status&&result.status!=='accepted'){item.state=result.status;await this.manager.save();break}saved.unread.shift();await this.manager.save()}catch(error){item.state='unknown';await this.manager.save();throw error}}
 }
 deliver(key,value,options,send){return this.serialize(this.recipient(key),async()=>{
 if(options?.current&&!options.current())return {status:'cancelled'};
 const e=this.entry(key);if(!e)return send(key,value,options);
 if(options?.conversationControl)return send(key,this.label(key,value),options);
 if(e.deleted)return {status:'cancelled'};
 if(this.find(e.owner)?.key===key){await this.flush(key,send);const saved=this.root[e.owner].entries.find(x=>x.key===key);if(!saved.unread?.length)return send(key,this.label(key,value),options);}
 const saved=this.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];saved.unread.push({value:structuredClone(value),state:'pending'});await this.manager.save();
 const text=typeof value==='string'?value:value.text;
 if(/(?:本轮回答结束|本轮执行失败，回答已结束|本轮已停止)/.test(text)&&this.find(e.owner)?.key!==key)await send(key,`会话${e.id}：${e.name} 的任务已结束，切换${e.id}后查看未展示消息。`,options);
 return {status:'deferred'};
 })}
 replay(key,send){return this.serialize(this.recipient(key),()=>this.flush(key,send))}
 titleUpdated(threadId,name){for(const r of Object.values(this.root))for(const e of r.entries)if(this.manager.state.users[e.key]?.threadId===threadId){e.name=typeof name==='string'&&name.trim()?name.trim().slice(0,60):'未命名对话 '+e.id;e.titleSource=name?.trim()?'codex':'placeholder';}return this.manager.save();}
 async rename(entry,name,reply){
 const session=await this.manager.connect(entry.key,this.manager.sessions.get(entry.key)?.reply??reply),threadId=this.manager.state.users[entry.key]?.threadId??session.threadId;
 if(!threadId)throw Error('Codex尚未确认会话，未修改标题。');
 let failure;try{await session.rpc.request('thread/name/set',{threadId,name});}catch(e){failure=e;}
 const result=await session.rpc.request('thread/read',{threadId,includeTurns:false});
 if(result.thread?.name!==name)throw Error(failure?'Codex标题修改结果未确认，请查看列表核对，未自动重试。':'Codex返回的标题与请求不一致，未确认修改。');
 await this.titleUpdated(threadId,result.thread.name);
 }
 // Codex is authoritative for persisted threads. Local archived is only a verified cache.
 async withCatalogRpc(owner,work){
  const existing=[...this.manager.sessions.values()].find(s=>!s.rpc?.closed&&s.rpc?.request&&this.recipient(s.userId)===owner);
  if(existing)return work(existing.rpc);
  const rpc=this.manager.createCatalogRpc?this.manager.createCatalogRpc():new CodexRpc({cwd:this.manager.cwd??process.cwd(),onEvent:()=>{},onClose:()=>{}});
  try{await rpc.request('initialize',{clientInfo:{name:'wechat_catalog',version:'1.0.0'}});rpc.write({method:'initialized',params:{}});return await work(rpc)}finally{rpc.close()}
 }
 async officialCatalog(rpc,owner){
  const catalog=new Map();
  for(const archived of [false,true]){let cursor;const seen=new Set();do{
   const page=await rpc.request('thread/list',{limit:100,archived,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],...(cursor?{cursor}:{})});
   if(!Array.isArray(page.data))throw Error('Codex会话列表返回不完整，未更改微信归档状态。');
   for(const thread of page.data)catalog.set(thread.id,{thread,archived});
   cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('Codex会话列表分页异常。');seen.add(cursor);
  }while(cursor)}
  // 0.163.0 omits empty threads from thread/list. Read only owned missing IDs;
  // use the official returned rollout location, never inspect or edit its database.
  if(owner)for(const e of this.ensure(owner).entries){const tid=this.manager.state.users[e.key]?.threadId;if(!tid||e.deleted||catalog.has(tid))continue;
   const own=this.manager.sessions.get(e.key);const reader=own?.rpc&&!own.rpc.closed?own.rpc:rpc;
   let thread;try{thread=(await reader.request('thread/read',{threadId:tid,includeTurns:false})).thread}catch(error){if(error.definitiveRpcError&&/no rollout|not found|does not exist/i.test(error.message))continue;throw error}
   if(thread?.id!==tid)throw Error('Codex未确认会话标识，未更新列表。');
   const path=thread.path?.replaceAll('\\','/');
   const archived=typeof thread.archived==='boolean'?thread.archived:path?.includes('/archived_sessions/')?true:path?.includes('/sessions/')?false:undefined;
   if(archived===undefined)throw Error('当前Codex版本未提供可核实的空白会话归档状态。');
   catalog.set(tid,{thread,archived});
  }
  return catalog;
 }
 applyCatalog(owner,catalog){
  const r=this.ensure(owner);
  for(const e of r.entries){const tid=this.manager.state.users[e.key]?.threadId;if(!tid)continue;const item=catalog.get(tid);
   if(!item){if(e.deleteIntent)this.markDeleted(tid);else if(!e.deleted)e.archiveSync='missing';continue}
   if(e.deleted){e.deleteSync='conflict';continue;}
   // Persisted legacy hide flags never override the official store.
   e.archived=item.archived;e.archiveSync='confirmed';if(e.deleteIntent)e.deleteSync='unknown';e.officialStatus=item.thread.status?.type;
   const name=item.thread.name;e.name=typeof name==='string'&&name.trim()?name.replace(/[\r\n]/g,' ').slice(0,60):'未命名对话 '+e.id;e.titleSource=name?.trim()?'codex':'placeholder';
   if(e.archiveIntent===item.archived)delete e.archiveIntent;
  }
  if(r.entries.find(e=>e.id===r.active)?.archived){const next=r.entries.find(e=>!e.archived&&e.archiveSync!=='missing');if(next)r.active=next.id;}
 }
 async refreshTitles(owner){
  await this.withCatalogRpc(owner,async rpc=>{const catalog=await this.officialCatalog(rpc,owner);this.applyCatalog(owner,catalog);await this.manager.save()});
 }
 async control(message,reply){const cmd=message._conversationCommand;if(!cmd)return false;const originalReply=reply;reply=(value,options)=>originalReply(value,{...options,conversationControl:true});await this.manager.save();const owner=message._conversationOwner;if(cmd.action==='switch'&&this.find(owner,cmd.id))delete message._conversationError;if(message._conversationError){await reply(message._conversationError);return true;}
 const r=this.ensure(owner),e=this.find(owner,cmd.id);if(cmd.action==='list'){await this.refreshTitles(owner,reply);const lines=r.entries.filter(e=>!e.archived&&!e.deleted).map(e=>{const s=this.manager.sessions.get(e.key),state=this.manager.state.users[e.key]?.recovery?.execution;return `${e.id}. ${e.name}${e.id===r.active?' [当前]':''} · ${s?.busy||e.officialStatus==='active'?'执行中':s?.finishing?'发送中':e.deleteIntent?'删除状态待核对':e.archiveSync==='missing'?'Codex记录缺失':e.archiveIntent!==undefined?'归档状态待核对':state==='unknown'?'结果待核对':!this.manager.state.users[e.key]?.threadId?'尚未连接Codex':'空闲'}`});await reply('会话列表\n'+lines.join('\n')+'\n切换2｜新建 名称｜命名 名称｜历史｜历史2｜翻页｜搜索 关键词｜归档2｜还原2｜删除2（永久删除，含派生子会话，不可还原）\n停止 只停止当前会话，切换不会停止其他任务。');}
 else if(cmd.action==='delete'){await this.deleteConversation(owner,e,reply);}
 else if(cmd.action==='archive'||cmd.action==='unarchive'){await this.archive(owner,e,cmd.action==='archive',reply);}
 else if(cmd.action==='rename'){const current=this.find(owner);await this.rename(current,cmd.name,reply);await reply(`会话${current.id}的Codex标题已更新为：${current.name}。`);}
 else if(cmd.action==='new'||cmd.action==='switch'){await this.selectOfficial(message,reply);}
 else{if(!e&&cmd.action!=='older'){await reply('会话不存在。');return true;}await this.history(owner,e,cmd,reply);}return true;}
 async selectOfficial(message,reply){
  const owner=message._conversationOwner,cmd=message._conversationCommand,r=this.ensure(owner);
  const current=cmd.action==='switch'?this.find(owner,cmd.id):r.entries.find(e=>e.key===message.userId);
  let confirmed=false;
  try{
   await this.refreshTitles(owner);
   if(!current||current.deleted||current.deleteIntent||current.archived||current.archiveSync==='missing')throw Error('目标会话已归档或Codex记录缺失，未连接；请先查看列表或还原。');
   const session=await this.manager.connect(current.key,this.manager.sessions.get(current.key)?.reply??reply);
   const tid=this.manager.state.users[current.key]?.threadId??session.threadId;
   if(!tid)throw Error('Codex尚未确认会话，未报告新建或切换成功。');
   const official=(await session.rpc.request('thread/read',{threadId:tid,includeTurns:false})).thread;
   if(official?.id!==tid)throw Error('Codex未确认目标会话，未报告成功。');
   if(r.selectionVersion===message._conversationSelectionVersion)r.active=current.id;
   await this.manager.save();confirmed=true;
   if(cmd.action==='new'&&cmd.name)await this.rename(current,cmd.name,reply);
   else if(official.name)await this.titleUpdated(tid,official.name);
   await reply(`Codex已确认${cmd.action==='new'?'新建':'连接'}会话${current.id}：${current.name}。后续消息进入此会话，其他会话任务继续执行。`);if(this.sendOutput)await this.replay(current.key,this.sendOutput);
  }finally{
   if(!confirmed&&r.selectionVersion===message._conversationSelectionVersion&&message._conversationPriorActive&&this.find(owner,message._conversationPriorActive)&&!this.find(owner,message._conversationPriorActive).archived){r.active=message._conversationPriorActive;await this.manager.save();}
  }
 }
 async archive(owner,entry,archived,reply){
  if(!entry){await reply('会话不存在，请先发“列表”。');return;}
  if(entry.deleted||entry.deleteIntent){await reply(entry.deleted?'该会话已永久删除，不能归档或还原。':'该会话的删除结果尚未确认，先用“列表”核对。');return;}
  const r=this.ensure(owner),session=this.manager.sessions.get(entry.key),saved=this.manager.state.users[entry.key];
  const blocked=()=>session&&(session.busy||session.finishing||session.connecting||session.selecting||session.exiting||session.queue?.length||session.state==='stopping')||['unknown','running','submitted'].includes(saved?.recovery?.execution)||(this.manager.submissions?.pending?.()??[]).some(j=>j.owner===entry.key)||this.manager.submissions?.uncertainCount?.(entry.key);
  if(blocked()){await reply('该会话仍有执行、排队或未确认任务，暂不能更改归档。');return;}
  if(this.archiveLocks?.has(entry.key)){await reply('该会话的归档状态正在核对。');return;}
  this.archiveLocks??=new Set();this.archiveLocks.add(entry.key);
  let locked=false;
  try{
   if(session){session.selecting=true;locked=true}
   await this.withCatalogRpc(owner,async reader=>{
    const rpc=session?.rpc&&!session.rpc.closed?session.rpc:reader;
    const before=await this.officialCatalog(reader,owner);this.applyCatalog(owner,before);
    const tid=saved?.threadId;
    if(tid&&!before.has(tid)){await this.manager.save();await reply('Codex中找不到该会话，未更改归档；请先核对历史记录。');return;}
    const next=r.entries.find(e=>e.id!==entry.id&&!e.archived&&e.archiveSync!=='missing');
    if(archived&&r.active===entry.id&&!next){await reply('请先新建一个会话，再归档最后一个会话。');return;}
    if(tid&&before.get(tid).thread.status?.type==='active'){await reply('Codex会话仍在执行，暂不能归档。');return;}
    // Empty slots have no Codex thread yet, so only their local navigation record exists.
    if(tid&&before.get(tid).archived!==archived){
     entry.archiveIntent=archived;await this.manager.save();
     let failure;try{await rpc.request(archived?'thread/archive':'thread/unarchive',{threadId:tid})}catch(error){failure=error}
     let after;try{after=await this.officialCatalog(reader,owner)}catch{entry.archiveSync='unknown';await this.manager.save();await reply('Codex归档结果暂未确认；未报告成功，稍后用“列表”核对，不自动重发操作。');return;}
     this.applyCatalog(owner,after);
     if(after.get(tid)?.archived!==archived){
      if(failure?.definitiveRpcError)delete entry.archiveIntent;
      await this.manager.save();await reply(failure?.definitiveRpcError?'Codex未接受归档变更，微信已按官方状态核对；会话可能仍被其他连接占用。':'Codex归档结果尚未确认，未报告成功；用“列表”继续核对。');return;
     }
    }
    entry.archived=archived;entry.archiveSync='confirmed';delete entry.archiveIntent;
    if(tid&&session&&this.manager.sessions.get(entry.key)===session){this.manager.sessions.delete(entry.key);if(this.manager.detachRpc)this.manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.();}
    if(archived&&r.active===entry.id)r.active=next.id;
    await this.manager.save();
    await reply(archived?`已归档会话${entry.id}：${entry.name}。${tid?'Codex与微信状态已核对一致，':'空白会话已隐藏，'}历史保留；发送“还原${entry.id}”可恢复。当前会话${r.active}。`:`已还原会话${entry.id}：${entry.name}。${tid?'Codex与微信状态已核对一致。':''}发送“切换${entry.id}”进入。`);
   });
  }finally{if(locked)session.selecting=false;this.archiveLocks.delete(entry.key)}
 }
 markDeleted(threadId){
  for(const [owner,r]of Object.entries(this.root))for(const e of r.entries)if(this.manager.state.users[e.key]?.threadId===threadId){
   e.deleted=true;e.archived=true;e.deleteSync='confirmed';delete e.deleteIntent;delete e.archiveIntent;e.unread=[];if(this.pages.get(owner)?.id===e.id)this.pages.delete(owner);
   const session=this.manager.sessions.get(e.key);
   if(session&&!session.busy&&!session.finishing&&!this.archiveLocks?.has(e.key)){this.manager.sessions.delete(e.key);if(this.manager.detachRpc)this.manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.();}
   if(r.active===e.id){const next=r.entries.find(x=>x.id!==e.id&&!x.deleted&&!x.archived);if(next)r.active=next.id;}
  }
 }
 async deleteConversation(owner,entry,reply){
  if(!entry||this.find(owner,entry.id)?.key!==entry.key){await reply('会话不存在，请先查看列表。');return;}
  if(entry.deleted){await reply(`会话${entry.id}已永久删除，不能还原。`);return;}
  const r=this.ensure(owner),session=this.manager.sessions.get(entry.key),saved=this.manager.state.users[entry.key],tid=saved?.threadId;
  const busy=key=>{const s=this.manager.sessions.get(key),v=this.manager.state.users[key];return s&&(s.busy||s.finishing||s.connecting||s.selecting||s.exiting||s.queue?.length||s.state==='stopping')||['unknown','running','submitted'].includes(v?.recovery?.execution)||(this.manager.submissions?.pending?.()??[]).some(j=>j.owner===key)||this.manager.submissions?.uncertainCount?.(key)};
  if(busy(entry.key)){await reply('该会话仍有执行、排队或未确认任务，暂不能永久删除。');return;}
  if(this.archiveLocks?.has(entry.key)){await reply('该会话正在更改状态，暂不能永久删除。');return;}
  if(!tid){await reply('该条目尚无Codex会话，不能调用thread/delete；未冒称永久删除成功。');return;}
  if(r.active===entry.id&&!r.entries.some(e=>e.id!==entry.id&&!e.archived&&!e.deleted)){await reply('请先新建一个会话，再删除最后一个当前会话。');return;}
  this.archiveLocks??=new Set();const keys=new Set([entry.key]);this.archiveLocks.add(entry.key);if(session)session.selecting=true;
  try{await this.withCatalogRpc(owner,async reader=>{
   const before=await this.officialCatalog(reader,owner);this.applyCatalog(owner,before);
   // A previous uncertain deletion is reconciled by reads only, never replayed.
   if(entry.deleted){await this.manager.save();await reply(`已核实会话${entry.id}已永久删除，不能还原。`);return;}
   if(entry.deleteIntent){await this.manager.save();await reply('此前删除结果尚未确认，未再次提交删除；用“列表”继续核对。');return;}
   if(!before.has(tid)){await this.manager.save();await reply('Codex记录缺失，无法确认是否已被删除，未提交新删除请求。');return;}
   const ids=new Set([tid]);let changed=true;while(changed){changed=false;for(const [id,{thread}]of before)if(ids.has(thread.parentThreadId)&&!ids.has(id)){ids.add(id);changed=true;}}
   if([...ids].some(id=>before.get(id)?.thread.status?.type==='active')){await reply('目标会话或派生子会话仍在执行，暂不能永久删除。');return;}
   for(const [otherOwner,root]of Object.entries(this.root))for(const e of root.entries)if(ids.has(this.manager.state.users[e.key]?.threadId)&&e.key!==entry.key){if(otherOwner!==owner||busy(e.key)||this.archiveLocks.has(e.key)){await reply('派生会话仍被占用或属于其他用户，未提交永久删除。');return;}keys.add(e.key);}
   for(const key of keys){this.archiveLocks.add(key);const child=this.manager.sessions.get(key);if(child)child.selecting=true;}
   entry.deleteIntent=true;entry.deleteSync='unknown';await this.manager.save();
   const target=session?.rpc&&!session.rpc.closed?session.rpc:reader;let failure,accepted=false;
   try{await target.request('thread/delete',{threadId:tid});accepted=true}catch(error){failure=error}
   // The official successful reply confirms deletion of root and descendants.
   if(accepted){for(const id of ids)this.markDeleted(id);await this.manager.save();await reply(`已永久删除会话${entry.id}：${entry.name}及其派生子会话。Codex已确认删除，历史不可还原。`);return;}
   let after;try{after=await this.officialCatalog(reader,owner)}catch{await this.manager.save();await reply('Codex删除结果暂未确认，未报告成功，也不自动重发；用“列表”核对。');return;}
   if(!after.has(tid)){for(const id of ids)if(!after.has(id))this.markDeleted(id);await this.manager.save();await reply(`已核实会话${entry.id}已从Codex永久删除，不能还原。`);return;}
   this.applyCatalog(owner,after);if(failure?.definitiveRpcError){delete entry.deleteIntent;entry.deleteSync='rejected';}
   await this.manager.save();await reply(failure?.definitiveRpcError?'Codex拒绝永久删除，会话仍保留；未改为归档。':'Codex删除结果尚未确认，会话仍可查到；未再次提交删除请求。');
  })}finally{for(const key of keys){this.archiveLocks.delete(key);const live=this.manager.sessions.get(key);if(live){live.selecting=false;const e=this.entry(key);if(e?.deleted&&!live.busy&&!live.finishing){this.manager.sessions.delete(key);if(this.manager.detachRpc)this.manager.detachRpc(live,live.rpcAttempt);else live.rpc?.close?.();}}}if(session)session.selecting=false}
 }
 async history(owner,entry,cmd,reply){if(entry?.deleted){await reply('该会话已永久删除，历史不可读取或还原。');return;}const old=this.pages.get(owner);if(cmd.action==='older'){if(!old){await reply('先发“历史”选择要查看的会话。');return;}entry=this.find(owner,old.id);if(!old.cursor){await reply('已到当前可读取历史的最早一页。');return;}}
 const tid=this.manager.state.users[entry.key]?.threadId;if(!tid){await reply('该会话还没有消息。');return;}
 const cursor=cmd.action==='older'?old.cursor:undefined;
 const page=await this.withCatalogRpc(owner,rpc=>rpc.request('thread/turns/list',{threadId:tid,limit:cmd.action==='search'?50:5,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})}));
 const lines=[];for(const turn of [...(page.data??[])].reverse())for(const item of turn.items??[]){let text;if(item.type==='userMessage')text=(item.content??[]).filter(c=>c.type==='text'&&!/^(接入层任务状态元数据|接入层记忆元数据|本轮材料关联状态|相关记忆（仅资料|当前附件用于继续)/.test(c.text??'')).map(c=>c.text).join('\n');else if(item.type==='agentMessage')text=item.text;text=historyText(text??'');if(text&&(!cmd.q||text.toLowerCase().includes(cmd.q.toLowerCase())))lines.push(`${item.type==='userMessage'?'你':'助手'}：${text.length>850?text.slice(0,850)+'\n〔长消息节选〕':text}`);}
 this.pages.set(owner,{id:entry.id,cursor:page.nextCursor});await reply(`会话${entry.id} · ${entry.name} ${cmd.action==='search'?'最近50轮搜索结果':'历史'}\n`+(lines.join('\n\n')||'本页没有匹配的文字消息。')+(page.nextCursor?'\n回复“翻页”继续；搜索仅覆盖本次读取范围。':''));}
}
