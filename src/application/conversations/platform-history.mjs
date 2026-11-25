import {createHash} from 'node:crypto'
import {nativeThreadIds} from '../../domain/conversations/native-sessions.mjs'
import {historyInputText,historyText} from './history.mjs'
// A read model over existing inbox/jobs/results, not a second conversation store.
export function platformHistory(context,owner,entry,cursor){
 const record=context.manager.state.users[entry.key]??{},threads=nativeThreadIds(record),jobs=context.manager.submissions
 const queue=jobs?.companionMessages?.(entry.key,threads.length?threads:'')??[]
 const receipts=jobs?.companionIngress?.(entry.key,threads.length?threads:'')??[]
 const seen=new Set(),messages=[]
 for(const receipt of receipts){
  const matching=queue.filter(job=>job.id===receipt.chat_job||job.ingress_id===receipt.id)
  if(!threads.includes(receipt.chat_thread)&&!matching.some(job=>threads.includes(job.thread_id)))continue
  for(const job of matching)seen.add(job.id)
  messages.push({id:receipt.id,role:'user',text:historyText(historyInputText(receipt.text??'')),at:receipt.created})
 }
 for(const job of queue)if(!seen.has(job.id))messages.push({id:job.id,role:'user',text:historyText(historyInputText(job.text??'')),at:job.created})
 const results=[...(record.resultArchive??[]).filter(r=>r.identity.id!==record.resultIdentity?.id),{identity:record.resultIdentity,lastReply:record.lastReply}]
 for(const result of results)if(result.lastReply&&threads.includes(result.identity?.threadId))messages.push({id:result.identity.id,role:'assistant',turnId:result.identity.turnId,text:historyText(result.lastReply),at:Date.parse(result.identity.createdAt)})
 messages.sort((a,b)=>a.at-b.at)
 const digest=createHash('sha256').update(JSON.stringify(messages)).digest('hex')
 const position=cursor?context.credential(cursor,'platform-history',owner):{projectId:entry.id,index:0,offset:0}
 if(position.projectId!==entry.id||position.digest&&position.digest!==digest)throw Error('MANAGEMENT_HISTORY_CHANGED')
 let index=position.index,offset=position.offset,budget=10000;const page=[]
 while(index<messages.length&&budget){
  const item=messages[index],characters=Array.from(item.text.slice(offset)),text=characters.slice(0,budget).join('')
  page.push({...item,text,offset,continued:offset>0,hasMore:offset+text.length<item.text.length})
  offset+=text.length;budget-=Math.min(budget,characters.length)
  if(offset>=item.text.length){index++;offset=0}
 }
 return {source:'platform',messages:page,order:'oldest_first',retention:'existing_recent_records',nextCursor:index<messages.length?context.sign({kind:'platform-history',owner,projectId:entry.id,digest,index,offset,expires:context.now()+600000}):null,attachmentsResent:false}
}
