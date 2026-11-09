import {CodexRpc} from '../../base/codex/codex-rpc.mjs'

export function createCodexConversationBackend(manager){
 const connection=handle=>handle?.rpc??handle;
 return {
  capabilities:{catalog:true,archive:true,delete:true,history:true,remoteRename:true},
  async withConnection(owner,recipient,work){
   const existing=[...manager.sessions.values()].find(s=>!s.rpc?.closed&&s.rpc?.request&&recipient(s.userId)===owner);
   if(existing)return work(existing.rpc);
   const rpc=manager.createCatalogRpc?manager.createCatalogRpc():new CodexRpc({cwd:manager.cwd??process.cwd(),onEvent:()=>{},onClose:()=>{}});
   try{await rpc.request('initialize',{clientInfo:{name:'wechat_catalog',version:'1.0.0'}});rpc.write({method:'initialized',params:{}});return await work(rpc)}finally{rpc.close()}
  },
  async list(rpc,ownedThreads){
   const catalog=new Map();
   for(const archived of [false,true]){let cursor;const seen=new Set();do{
    const page=await rpc.request('thread/list',{limit:100,archived,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],...(cursor?{cursor}:{})});
    if(!Array.isArray(page.data))throw Error('Codex会话列表返回不完整，未更改微信归档状态。');
    for(const thread of page.data)catalog.set(thread.id,{thread,archived});
    cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('Codex会话列表分页异常。');seen.add(cursor);
   }while(cursor)}
   // Empty Codex threads may be absent from thread/list; verify owned IDs only.
   for(const {key,threadId} of ownedThreads){if(!threadId||catalog.has(threadId))continue;
    const own=manager.sessions.get(key);const reader=own?.rpc&&!own.rpc.closed?own.rpc:rpc;
    let thread;try{thread=await this.readConversation(reader,threadId)}catch(error){if(error.definitiveRpcError&&/no rollout|not found|does not exist/i.test(error.message))continue;throw error}
    if(thread?.id!==threadId)throw Error('Codex未确认会话标识，未更新列表。');
    const path=thread.path?.replaceAll('\\','/');
    const archived=typeof thread.archived==='boolean'?thread.archived:path?.includes('/archived_sessions/')?true:path?.includes('/sessions/')?false:undefined;
    if(archived===undefined)throw Error('当前Codex版本未提供可核实的空白会话归档状态。');
    catalog.set(threadId,{thread,archived});
   }
   return catalog;
  },
  connectionFor(session,fallback){return session?.rpc&&!session.rpc.closed?session.rpc:fallback},
  closeSession(session){if(manager.detachRpc)manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.()},
  async readConversation(handle,threadId){return (await connection(handle).request('thread/read',{threadId,includeTurns:false})).thread},
  async confirmSession(session,threadId){return this.readConversation(session,threadId)},
  async renameConversation(handle,threadId,name){await connection(handle).request('thread/name/set',{threadId,name})},
  async setArchived(handle,threadId,archived){await connection(handle).request(archived?'thread/archive':'thread/unarchive',{threadId})},
  async deleteConversation(handle,threadId){await connection(handle).request('thread/delete',{threadId})},
  async listTurns(handle,threadId,{limit,cursor}={}){
   return connection(handle).request('thread/turns/list',{threadId,limit,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});
  }
 }
}
