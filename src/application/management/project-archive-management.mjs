import {managementWrite} from './management-writes.mjs'

export function requestProjectArchive(context,owner,caller,args){return managementWrite(context,owner,caller,'request_project_archive',args,async op=>{
 if(!context.conversations.backendPort?.capabilities.catalog)throw Error('MANAGEMENT_UNSUPPORTED')
 const entry=context.target(owner,args.projectId)
 if(context.manager.agentFor?.(entry.key)==='claude')throw Error('MANAGEMENT_UNSUPPORTED')
 if(entry.deleteIntent||entry.archiveIntent!==undefined||context.conversations.archiveLocks?.has(entry.key))throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 op.threadId=context.manager.state.users[entry.key]?.threadId??null;op.archived=args.archived
 op.callerTask=context.manager.sessions.get(caller)?.traceId;op.status='pending'
})}
export async function executeProjectArchive(context,op){
 const entry=context.target(op.owner,op.projectId),caller=context.manager.sessions.get(op.caller)
 if((context.manager.state.users[entry.key]?.threadId??null)!==op.threadId)throw Error('MANAGEMENT_STALE_TARGET')
 if(entry.key===op.caller){
  if(caller?.traceId!==op.callerTask)throw Error('MANAGEMENT_SUPERSEDED')
  if(caller?.busy||caller?.finishing||caller?.connecting){await context.activate(op.caller,op.id);return false}
 }
 op.status='executing';await context.manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 if((context.manager.state.users[entry.key]?.threadId??null)!==op.threadId)throw Error('MANAGEMENT_STALE_TARGET')
 const previousActive=context.conversations.root[op.owner].active
 const result=await context.conversations.archive(op.owner,entry,op.archived,async()=>{})
 if(!['confirmed','not_executed','unknown','rejected'].includes(result?.status))throw Error('ARCHIVE_RECEIPT_UNCONFIRMED')
 op.status=result.status;op.detail=result.reason??null;op.data={archived:result.archived??null,selectionChanged:context.conversations.root[op.owner].active!==previousActive}
}
