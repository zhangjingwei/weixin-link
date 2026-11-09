import {CodexRpc} from '../../base/codex/codex-rpc.mjs'
export function installOfficialHooks(context){
  context.manager.beforeConversationConnect=async key=>{
   if(context.archiveLocks?.has(key))throw Error('该会话正在更改归档状态，请稍后继续。');
   const e=context.entry(key),tid=context.manager.state.users[key]?.threadId;if(e?.deleted)throw Error('该会话已被Codex永久删除，不能继续或还原。');if(!e||!tid)return;
   await context.withCatalogRpc(e.owner,async rpc=>{const catalog=await context.officialCatalog(rpc,e.owner);context.applyCatalog(e.owner,catalog);await context.manager.save();const item=catalog.get(tid);if(!item)throw Error('Codex记录缺失，未自动新建替代会话。');if(item.archived)throw Error('Codex会话已归档，请先还原后继续。');});
  };
  context.manager.onConversationDelete=async threadId=>{context.markDeleted(threadId);await context.manager.save()};
  context.manager.onConversationArchive=async(threadId,archived)=>{
   for(const r of Object.values(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){if(e.deleted)continue;e.archived=archived;e.archiveSync='confirmed';if(e.archiveIntent===archived)delete e.archiveIntent;}
   await context.manager.save();
  };
 }

export function titleUpdated(context,threadId,name){for(const r of Object.values(context.root))for(const e of r.entries)if(context.manager.state.users[e.key]?.threadId===threadId){e.name=typeof name==='string'&&name.trim()?name.trim().slice(0,60):'未命名对话 '+e.id;e.titleSource=name?.trim()?'codex':'placeholder';}return context.manager.save();}

export async function withCatalogRpc(context,owner,work){
  const existing=[...context.manager.sessions.values()].find(s=>!s.rpc?.closed&&s.rpc?.request&&context.recipient(s.userId)===owner);
  if(existing)return work(existing.rpc);
  const rpc=context.manager.createCatalogRpc?context.manager.createCatalogRpc():new CodexRpc({cwd:context.manager.cwd??process.cwd(),onEvent:()=>{},onClose:()=>{}});
  try{await rpc.request('initialize',{clientInfo:{name:'wechat_catalog',version:'1.0.0'}});rpc.write({method:'initialized',params:{}});return await work(rpc)}finally{rpc.close()}
 }

export async function officialCatalog(context,rpc,owner){
  const catalog=new Map();
  for(const archived of [false,true]){let cursor;const seen=new Set();do{
   const page=await rpc.request('thread/list',{limit:100,archived,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],...(cursor?{cursor}:{})});
   if(!Array.isArray(page.data))throw Error('Codex会话列表返回不完整，未更改微信归档状态。');
   for(const thread of page.data)catalog.set(thread.id,{thread,archived});
   cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('Codex会话列表分页异常。');seen.add(cursor);
  }while(cursor)}
  // 0.163.0 omits empty threads from thread/list. Read only owned missing IDs;
  // use the official returned rollout location, never inspect or edit its database.
  if(owner)for(const e of context.ensure(owner).entries){const tid=context.manager.state.users[e.key]?.threadId;if(!tid||e.deleted||catalog.has(tid))continue;
   const own=context.manager.sessions.get(e.key);const reader=own?.rpc&&!own.rpc.closed?own.rpc:rpc;
   let thread;try{thread=(await reader.request('thread/read',{threadId:tid,includeTurns:false})).thread}catch(error){if(error.definitiveRpcError&&/no rollout|not found|does not exist/i.test(error.message))continue;throw error}
   if(thread?.id!==tid)throw Error('Codex未确认会话标识，未更新列表。');
   const path=thread.path?.replaceAll('\\','/');
   const archived=typeof thread.archived==='boolean'?thread.archived:path?.includes('/archived_sessions/')?true:path?.includes('/sessions/')?false:undefined;
   if(archived===undefined)throw Error('当前Codex版本未提供可核实的空白会话归档状态。');
   catalog.set(tid,{thread,archived});
  }
  return catalog;
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
  await context.withCatalogRpc(owner,async rpc=>{const catalog=await context.officialCatalog(rpc,owner);context.applyCatalog(owner,catalog);await context.manager.save()});
 }
