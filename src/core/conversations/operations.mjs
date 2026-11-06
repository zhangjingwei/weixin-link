
export async function rename(context,entry,name,reply){}

export async function selectOfficial(context,message,reply){
  const owner=message._conversationOwner,cmd=message._conversationCommand,r=context.ensure(owner);
  const current=cmd.action==='switch'?context.find(owner,cmd.id):r.entries.find(e=>e.key===message.userId);
  let confirmed=false;
  try{
   await context.refreshTitles(owner);
   if(!current||current.deleted||current.deleteIntent||current.archived||current.archiveSync==='missing')throw Error('目标会话已归档或Codex记录缺失，未连接；请先查看列表或还原。');
   const session=await context.manager.connect(current.key,context.manager.sessions.get(current.key)?.reply??reply);
   const tid=context.manager.state.users[current.key]?.threadId??session.threadId;
   if(!tid)throw Error('Codex尚未确认会话，未报告新建或切换成功。');
   const official=(await session.rpc.request('thread/read',{threadId:tid,includeTurns:false})).thread;
   if(official?.id!==tid)throw Error('Codex未确认目标会话，未报告成功。');
   if(r.selectionVersion===message._conversationSelectionVersion)r.active=current.id;
   await context.manager.save();confirmed=true;
   if(cmd.action==='new'&&cmd.name)await context.rename(current,cmd.name,reply);
   else if(official.name)await context.titleUpdated(tid,official.name);
   await reply(`Codex已确认${cmd.action==='new'?'新建':'连接'}会话${current.id}：${current.name}。后续消息进入此会话，其他会话任务继续执行。`);if(context.sendOutput)await context.replay(current.key,context.sendOutput);
  }finally{
   if(!confirmed&&r.selectionVersion===message._conversationSelectionVersion&&message._conversationPriorActive&&context.find(owner,message._conversationPriorActive)&&!context.find(owner,message._conversationPriorActive).archived){r.active=message._conversationPriorActive;await context.manager.save();}
  }
 }

export async function archive(context,owner,entry,archived,reply){
  if(!entry){await reply('会话不存在，请先发“列表”。');return;}
  if(entry.deleted||entry.deleteIntent){await reply(entry.deleted?'该会话已永久删除，不能归档或还原。':'该会话的删除结果尚未确认，先用“列表”核对。');return;}
  const r=context.ensure(owner),session=context.manager.sessions.get(entry.key),saved=context.manager.state.users[entry.key];
  const blocked=()=>session&&(session.busy||session.finishing||session.connecting||session.selecting||session.exiting||session.queue?.length||session.state==='stopping')||['unknown','running','submitted'].includes(saved?.recovery?.execution)||(context.manager.submissions?.pending?.()??[]).some(j=>j.owner===entry.key)||context.manager.submissions?.uncertainCount?.(entry.key);
  if(blocked()){await reply('该会话仍有执行、排队或未确认任务，暂不能更改归档。');return;}
  if(context.archiveLocks?.has(entry.key)){await reply('该会话的归档状态正在核对。');return;}
  context.archiveLocks??=new Set();context.archiveLocks.add(entry.key);
  let locked=false;
  try{
   if(session){session.selecting=true;locked=true}
   await context.withCatalogRpc(owner,async reader=>{
    const rpc=session?.rpc&&!session.rpc.closed?session.rpc:reader;
    const before=await context.officialCatalog(reader,owner);context.applyCatalog(owner,before);
    const tid=saved?.threadId;
    if(tid&&!before.has(tid)){await context.manager.save();await reply('Codex中找不到该会话，未更改归档；请先核对历史记录。');return;}
    const next=r.entries.find(e=>e.id!==entry.id&&!e.archived&&e.archiveSync!=='missing');
    if(archived&&r.active===entry.id&&!next){await reply('请先新建一个会话，再归档最后一个会话。');return;}
    if(tid&&before.get(tid).thread.status?.type==='active'){await reply('Codex会话仍在执行，暂不能归档。');return;}
    // Empty slots have no Codex thread yet, so only their local navigation record exists.
    if(tid&&before.get(tid).archived!==archived){
     entry.archiveIntent=archived;await context.manager.save();
     let failure;try{await rpc.request(archived?'thread/archive':'thread/unarchive',{threadId:tid})}catch(error){failure=error}
     let after;try{after=await context.officialCatalog(reader,owner)}catch{entry.archiveSync='unknown';await context.manager.save();await reply('Codex归档结果暂未确认；未报告成功，稍后用“列表”核对，不自动重发操作。');return;}
     context.applyCatalog(owner,after);
     if(after.get(tid)?.archived!==archived){
      if(failure?.definitiveRpcError)delete entry.archiveIntent;
      await context.manager.save();await reply(failure?.definitiveRpcError?'Codex未接受归档变更，微信已按官方状态核对；会话可能仍被其他连接占用。':'Codex归档结果尚未确认，未报告成功；用“列表”继续核对。');return;
     }
    }
    entry.archived=archived;entry.archiveSync='confirmed';delete entry.archiveIntent;
    if(tid&&session&&context.manager.sessions.get(entry.key)===session){context.manager.sessions.delete(entry.key);if(context.manager.detachRpc)context.manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.();}
    if(archived&&r.active===entry.id)r.active=next.id;
    await context.manager.save();
    await reply(archived?`已归档会话${entry.id}：${entry.name}。${tid?'Codex与微信状态已核对一致，':'空白会话已隐藏，'}历史保留；发送“还原${entry.id}”可恢复。当前会话${r.active}。`:`已还原会话${entry.id}：${entry.name}。${tid?'Codex与微信状态已核对一致。':''}发送“切换${entry.id}”进入。`);
   });
  }finally{if(locked)session.selecting=false;context.archiveLocks.delete(entry.key)}
 }

export function markDeleted(context,threadId){
  for(const [owner,r]of Object.entries(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){
   e.deleted=true;e.archived=true;e.deleteSync='confirmed';delete e.deleteIntent;delete e.archiveIntent;e.unread=[];if(context.pages.get(owner)?.id===e.id)context.pages.delete(owner);
   const session=context.manager.sessions.get(e.key);
   if(session&&!session.busy&&!session.finishing&&!context.archiveLocks?.has(e.key)){context.manager.sessions.delete(e.key);if(context.manager.detachRpc)context.manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.();}
   if(r.active===e.id){const next=r.entries.find(x=>x.id!==e.id&&!x.deleted&&!x.archived);if(next)r.active=next.id;}
  }
 }

export async function deleteConversation(context,owner,entry,reply){
  if(!entry||context.find(owner,entry.id)?.key!==entry.key){await reply('会话不存在，请先查看列表。');return;}
  if(entry.deleted){await reply(`会话${entry.id}已永久删除，不能还原。`);return;}
  const r=context.ensure(owner),session=context.manager.sessions.get(entry.key),saved=context.manager.state.users[entry.key],tid=saved?.threadId;
  const busy=key=>{const s=context.manager.sessions.get(key),v=context.manager.state.users[key];return s&&(s.busy||s.finishing||s.connecting||s.selecting||s.exiting||s.queue?.length||s.state==='stopping')||['unknown','running','submitted'].includes(v?.recovery?.execution)||(context.manager.submissions?.pending?.()??[]).some(j=>j.owner===key)||context.manager.submissions?.uncertainCount?.(key)};
  if(busy(entry.key)){await reply('该会话仍有执行、排队或未确认任务，暂不能永久删除。');return;}
  if(context.archiveLocks?.has(entry.key)){await reply('该会话正在更改状态，暂不能永久删除。');return;}
  if(!tid){await reply('该条目尚无Codex会话，不能调用thread/delete；未冒称永久删除成功。');return;}
  if(r.active===entry.id&&!r.entries.some(e=>e.id!==entry.id&&!e.archived&&!e.deleted)){await reply('请先新建一个会话，再删除最后一个当前会话。');return;}
  context.archiveLocks??=new Set();const keys=new Set([entry.key]);context.archiveLocks.add(entry.key);if(session)session.selecting=true;
  try{await context.withCatalogRpc(owner,async reader=>{
   const before=await context.officialCatalog(reader,owner);context.applyCatalog(owner,before);
   // A previous uncertain deletion is reconciled by reads only, never replayed.
   if(entry.deleted){await context.manager.save();await reply(`已核实会话${entry.id}已永久删除，不能还原。`);return;}
   if(entry.deleteIntent){await context.manager.save();await reply('此前删除结果尚未确认，未再次提交删除；用“列表”继续核对。');return;}
   if(!before.has(tid)){await context.manager.save();await reply('Codex记录缺失，无法确认是否已被删除，未提交新删除请求。');return;}
   const ids=new Set([tid]);let changed=true;while(changed){changed=false;for(const [id,{thread}]of before)if(ids.has(thread.parentThreadId)&&!ids.has(id)){ids.add(id);changed=true;}}
   if([...ids].some(id=>before.get(id)?.thread.status?.type==='active')){await reply('目标会话或派生子会话仍在执行，暂不能永久删除。');return;}
   for(const [otherOwner,root]of Object.entries(context.root))for(const e of root.entries)if(ids.has(context.manager.state.users[e.key]?.threadId)&&e.key!==entry.key){if(otherOwner!==owner||busy(e.key)||context.archiveLocks.has(e.key)){await reply('派生会话仍被占用或属于其他用户，未提交永久删除。');return;}keys.add(e.key);}
   for(const key of keys){context.archiveLocks.add(key);const child=context.manager.sessions.get(key);if(child)child.selecting=true;}
   entry.deleteIntent=true;entry.deleteSync='unknown';await context.manager.save();
   const target=session?.rpc&&!session.rpc.closed?session.rpc:reader;let failure,accepted=false;
   try{await target.request('thread/delete',{threadId:tid});accepted=true}catch(error){failure=error}
   // The official successful reply confirms deletion of root and descendants.
   if(accepted){for(const id of ids)context.markDeleted(id);await context.manager.save();await reply(`已永久删除会话${entry.id}：${entry.name}及其派生子会话。Codex已确认删除，历史不可还原。`);return;}
   let after;try{after=await context.officialCatalog(reader,owner)}catch{await context.manager.save();await reply('Codex删除结果暂未确认，未报告成功，也不自动重发；用“列表”核对。');return;}
   if(!after.has(tid)){for(const id of ids)if(!after.has(id))context.markDeleted(id);await context.manager.save();await reply(`已核实会话${entry.id}已从Codex永久删除，不能还原。`);return;}
   context.applyCatalog(owner,after);if(failure?.definitiveRpcError){delete entry.deleteIntent;entry.deleteSync='rejected';}
   await context.manager.save();await reply(failure?.definitiveRpcError?'Codex拒绝永久删除，会话仍保留；未改为归档。':'Codex删除结果尚未确认，会话仍可查到；未再次提交删除请求。');
  })}finally{for(const key of keys){context.archiveLocks.delete(key);const live=context.manager.sessions.get(key);if(live){live.selecting=false;const e=context.entry(key);if(e?.deleted&&!live.busy&&!live.finishing){context.manager.sessions.delete(key);if(context.manager.detachRpc)context.manager.detachRpc(live,live.rpcAttempt);else live.rpc?.close?.();}}}if(session)session.selecting=false}
 }
