export function installOfficialHooks(context){
  context.manager.beforeConversationConnect=async key=>{
   if(context.archiveLocks?.has(key))throw Error('该会话正在更改归档状态，请稍后继续。');
   const e=context.entry(key),tid=context.manager.state.users[key]?.threadId;if(e?.deleted)throw Error('该会话已被Codex永久删除，不能继续或还原。');if(!e||!tid)return;
   await context.withBackend(e.owner,async connection=>{const catalog=await context.officialCatalog(connection,e.owner);context.applyCatalog(e.owner,catalog);await context.manager.save();const item=catalog.get(tid);if(!item)throw Error('Codex记录缺失，未自动新建替代会话。');if(item.archived)throw Error('Codex会话已归档，请先还原后继续。');});
  };
  context.manager.onConversationDelete=async threadId=>{context.markDeleted(threadId);await context.manager.save()};
  context.manager.onConversationArchive=async(threadId,archived)=>{
   for(const r of Object.values(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){if(e.deleted)continue;e.archived=archived;e.archiveSync='confirmed';if(e.archiveIntent===archived)delete e.archiveIntent;}
   await context.manager.save();
  };
 }

export function titleUpdated(context,threadId,name){for(const r of Object.values(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){e.name=typeof name==='string'&&name.trim()?name.trim().slice(0,60):'未命名对话 '+e.id;e.titleSource=name?.trim()?'codex':'placeholder';}return context.manager.save();}

export async function withBackend(context,owner,work){
  return context.backendPort.withConnection(owner,key=>context.recipient(key),work);
 }

export async function officialCatalog(context,connection,owner){
  const ownedThreads=owner?context.ensure(owner).entries.filter(e=>!e.deleted).map(e=>({key:e.key,threadId:context.manager.state.users[e.key]?.threadId})):[];
  return context.backendPort.list(connection,ownedThreads);
 }

export function applyCatalog(context,owner,catalog){
  const r=context.ensure(owner);
  for(const e of r.entries){const tid=context.manager.state.users[e.key]?.threadId;if(!tid)continue;const item=catalog.get(tid);
   if(!item){if(e.deleteIntent)context.markDeleted(tid);else if(!e.deleted)e.archiveSync='missing';continue}
   if(e.deleted){e.deleteSync='conflict';continue;}
   // Persisted legacy hide flags never override the official store.
   e.archived=item.archived;e.archiveSync='confirmed';if(e.deleteIntent)e.deleteSync='unknown';e.officialStatus=item.thread.status?.type;
   const name=item.thread.name;e.name=typeof name==='string'&&name.trim()?name.replace(/[\r\n]/g,' ').slice(0,60):'未命名对话 '+e.id;e.titleSource=name?.trim()?'codex':'placeholder';
   if(e.archiveIntent===item.archived)delete e.archiveIntent;
  }
  if(r.entries.find(e=>e.id===r.active)?.archived){const next=r.entries.find(e=>!e.archived&&e.archiveSync!=='missing');if(next)r.active=next.id;}
 }

export async function refreshTitles(context,owner){
  await context.withBackend(owner,async connection=>{const catalog=await context.officialCatalog(connection,owner);context.applyCatalog(owner,catalog);await context.manager.save()});
 }
