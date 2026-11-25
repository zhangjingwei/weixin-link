import {initializeCodex} from './protocol-operations.mjs'
import {listCodexProjects,nativeProjects} from './projects.mjs'

function archiveStatus(thread){
 const path=thread.path?.replaceAll('\\','/')
 return typeof thread.archived==='boolean'?thread.archived:path?.includes('/archived_sessions/')?true:path?.includes('/sessions/')?false:undefined
}

export function createCodexConversationBackend(manager){
 const connection=handle=>handle?.rpc??handle;
 return {
  nativeProjects,
  listProjects:listCodexProjects,
  capabilities:{catalog:true,archive:true,delete:true,history:true},
  async withConnection(owner,recipient,work){
   const existing=[...manager.sessions.values()].find(s=>(s.rpc?.agentKind??'codex')==='codex'&&!s.rpc?.closed&&s.rpc?.request&&recipient(s.userId)===owner);
   if(existing)return work(existing.rpc);
   const rpc=manager.createCatalogRpc();
   try{await initializeCodex(rpc,{name:'wechat_catalog',version:'1.0.0'});return await work(rpc)}finally{rpc.close()}
  },
  async searchHistory(rpc,{threadId,query,cursor,archived=false}){
   const params={searchTerm:query,limit:20,...(cursor?{cursor}:{})}
   const page=threadId
    ?await rpc.request('thread/searchOccurrences',{...params,threadId})
    :await rpc.request('thread/search',{...params,archived,sortKey:'updated_at',sortDirection:'desc'})
   if(!Array.isArray(page?.data)||page.data.length>20||
      (page.nextCursor!=null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor===cursor)))throw Error('CODEX_HISTORY_SEARCH_INVALID')
   const matches=[]
   for(const row of page.data){
    if(typeof row?.snippet!=='string')throw Error('CODEX_HISTORY_SEARCH_INVALID')
    if(threadId){
     if(!row.turnId||!row.itemId)throw Error('CODEX_HISTORY_SEARCH_INVALID')
     matches.push({turnId:row.turnId,itemId:row.itemId,snippet:row.snippet})
    }else{
     const thread=row.thread
     if(!thread?.id)throw Error('CODEX_HISTORY_SEARCH_INVALID')
     if(!thread.ephemeral&&!thread.parentThreadId)matches.push({threadId:thread.id,nativeProjectId:thread.projectId??null,name:thread.name??null,snippet:row.snippet})
    }
   }
   return {matches,nextCursor:page.nextCursor??null}
  },
  async queuedTasks(rpc,threadId,limit){
   const page=await rpc.request('thread/queue/list',{threadId,limit})
   return {items:page.data.map(item=>({taskId:item.id,title:item.input?.find(i=>i.type==='text')?.text.slice(0,120)??'附件'})),more:!!page.nextCursor}
  },
  async recentPersonalThreads(rpc){
   const threads=[]
   let cursor
   for(let page=0;page<5;page++){
    const result=await rpc.request('thread/list',{archived:false,limit:30,sortKey:'updated_at',sortDirection:'desc',modelProviders:[],sourceKinds:['cli','vscode','appServer'],...(cursor?{cursor}:{})})
    if(!Array.isArray(result.data))throw Error('CODEX_THREAD_LIST_INVALID')
    for(const thread of result.data){
     if(thread.ephemeral||thread.parentThreadId||!thread.id||!thread.cwd||/^(?:wechat|weixin|zerolink)/i.test(thread.originator??''))continue
     threads.push(thread)
     if(threads.length===5)return threads
    }
    cursor=result.nextCursor
    if(!cursor)break
   }
   return threads
  },
  async lookupThread(rpc,threadId){
   const thread=await this.readConversation(rpc,threadId)
   if(thread?.id!==threadId)throw Error('Codex未确认会话标识，未更新列表。')
   const archived=archiveStatus(thread)
   if(archived!==undefined)return {thread,archived}
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
    const thread=await this.readConversation(reader,threadId)
    if(thread?.id!==threadId)throw Error('Codex未确认会话标识，未更新列表。');
    const archived=archiveStatus(thread);
    if(archived===undefined)throw Error('当前Codex版本未提供可核实的空白会话归档状态。');
    catalog.set(threadId,{thread,archived});
   }
   return catalog;
  },
  connectionFor(session,fallback){return session?.rpc&&!session.rpc.closed?session.rpc:fallback},
  closeSession(session){if(manager.detachRpc)manager.detachRpc(session,session.rpcAttempt);else session.rpc?.close?.()},
  async readConversation(handle,threadId){return (await connection(handle).request('thread/read',{threadId,includeTurns:false})).thread},
  async confirmSession(session,threadId){return ['claude','workbuddy','doubao','grok'].includes(session.rpc?.agentKind)?manager.protocol.read(session.rpc,threadId):this.readConversation(session,threadId)},
  async renameConversation(handle,threadId,name){await connection(handle).request('thread/name/set',{threadId,name})},
  async setArchived(handle,threadId,archived){await connection(handle).request(archived?'thread/archive':'thread/unarchive',{threadId})},
  async deleteConversation(handle,threadId){await connection(handle).request('thread/delete',{threadId})},
  async listTurns(handle,threadId,{limit,cursor}={}){
   return connection(handle).request('thread/turns/list',{threadId,limit,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});
  }
 }
}
