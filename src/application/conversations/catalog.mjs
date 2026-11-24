import {bindNewWorkspace} from './workspace.mjs'
import {repairLegacyProjectWorkspace} from './native-projects.mjs'

export function installOfficialHooks(context){
  context.manager.beforeConversationConnect=async key=>{
   if(context.archiveLocks?.has(key))throw Error('该会话正在更改归档状态，请稍后继续。');
   const e=context.entry(key),tid=context.manager.state.users[key]?.threadId;if(e?.deleted)throw Error('该会话已被Codex永久删除，不能继续或还原。');if(!e)return
   if(e.pendingNativeProject){
    const entry=context.find(e.owner,e.id),intent=e.pendingNativeProject
    const workspace=await bindNewWorkspace(context,key,intent.path,{prepareOnly:true})
    await context.manager.save()
    const api=context.backendPort.nativeProjects
    if(!api)throw Error('当前底座不支持创建 Codex 项目。')
    const project=await context.withBackend(e.owner,rpc=>api.create(rpc,intent.name,workspace,key))
    Object.assign(context.manager.state.users[key]??={},{nativeProjectId:project.id,workspace})
    delete entry.pendingNativeProject
    await context.manager.save()
   }
   if(!tid)return;
   await context.withBackend(e.owner,async connection=>{
    let item=await context.backendPort.lookupThread?.(connection,tid)
    if(item)applyCatalog(context,e.owner,new Map([[tid,item]]),tid)
    else{
     const catalog=await context.officialCatalog(connection,e.owner)
     context.applyCatalog(e.owner,catalog)
     item=catalog.get(tid)
    }
    await context.manager.save()
    if(!item)throw Error('Codex记录缺失，未自动新建替代会话。')
    if(item.archived)throw Error('Codex会话已归档，请先还原后继续。')
    await repairLegacyProjectWorkspace(context,key,connection,item.thread)
   });
  };
  context.manager.onConversationDelete=async threadId=>{context.markDeleted(threadId);await context.manager.save()};
  context.manager.onConversationArchive=async(threadId,archived)=>{
   for(const r of Object.values(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){if(e.deleted)continue;e.archived=archived;e.archiveSync='confirmed';if(e.archiveIntent===archived)delete e.archiveIntent;}
   await context.manager.save();
  };
 }

function setConversationTitle(entry, owner, name, preview){
 const title=typeof name==='string'?name.trim().replace(/[\r\n]+/g,' ').slice(0,60):''
 const usablePreview=typeof preview==='string'&&!/^\s*(?:#\s*AGENTS\.md|<environment_context|接入层任务状态元数据)/i.test(preview)
 const topic=usablePreview?preview.trim().replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').slice(0,24):''
 if(topic)entry.topicTitle=topic
 entry.name=title||entry.topicTitle||(entry.key===owner?'当前会话':'会话 '+entry.id)
 entry.titleSource=title?'codex':entry.topicTitle?'preview':'placeholder'
}

export function titleUpdated(context,threadId,name){
 for(const [owner,root] of Object.entries(context.root)){
  for(const entry of root.entries){
   if(context.manager.state.users[entry.key]?.threadId===threadId)setConversationTitle(entry,owner,name)
  }
 }
 return context.manager.save()
}

export async function withBackend(context,owner,work){
  return context.backendPort.withConnection(owner,key=>context.recipient(key),work);
 }

export async function officialCatalog(context,connection,owner){
  const ownedThreads=owner?context.ensure(owner).entries.filter(e=>!e.deleted).map(e=>({key:e.key,threadId:context.manager.state.users[e.key]?.threadId})):[];
  return context.backendPort.list(connection,ownedThreads);
 }

export function applyCatalog(context,owner,catalog,onlyThread){
  const r=context.ensure(owner);
  for(const e of r.entries){const tid=context.manager.state.users[e.key]?.threadId;if(!tid||(onlyThread&&tid!==onlyThread))continue;const item=catalog.get(tid);
   if(!item){if(e.deleteIntent)context.markDeleted(tid);else if(!e.deleted)e.archiveSync='missing';continue}
   if(e.deleted){e.deleteSync='conflict';continue;}
   // Persisted legacy hide flags never override the official store.
   e.archived=item.archived;e.archiveSync='confirmed';if(e.deleteIntent)e.deleteSync='unknown';e.officialStatus=item.thread.status?.type;
   if(Object.hasOwn(item.thread,'projectId'))context.manager.state.users[e.key].nativeProjectId=item.thread.projectId
   setConversationTitle(e,owner,item.thread.name,item.thread.preview)
   if(e.archiveIntent===item.archived)delete e.archiveIntent;
  }
  if(r.entries.find(e=>e.id===r.active)?.archived){const next=r.entries.find(e=>!e.archived&&e.archiveSync!=='missing');if(next)r.active=next.id;}
 }

export async function refreshTitles(context,owner){
  await context.withBackend(owner,async connection=>{const catalog=await context.officialCatalog(connection,owner);context.applyCatalog(owner,catalog);await context.manager.save()});
 }
