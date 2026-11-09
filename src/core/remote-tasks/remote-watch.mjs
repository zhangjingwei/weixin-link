import {pathToFileURL,fileURLToPath} from 'node:url'
const botRoot=process.env.WECHAT_BOT_ROOT??fileURLToPath(new URL('../../../',import.meta.url))
// Lazy loading also allows the adapter's read-only actions without a local bot installation.
async function relay(body){
 const [{accountPaths},{controlRequest}]=await Promise.all([import(pathToFileURL(join(botRoot,'src/wechat/accounts.mjs'))),import(pathToFileURL(join(botRoot,'src/core/runtime/runtime-control.mjs')))])
 return controlRequest(accountPaths().socket,'POST','/remote-text',body,15000)
}
import {join,basename,win32} from 'node:path'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const digest=text=>createHash('sha256').update(text).digest('hex')
export async function watchTask(controller,input){
 if(input.timeoutMs!==undefined&&(!Number.isInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>300000))throw Error('INVALID_WATCH_TIMEOUT')
 const task=await controller.task(input.task),offsets=task.stream_offsets??{},pendingFinal=[];const label='【'+({spark:'Spark',server:'服务器'}[task.host]??task.host)+'｜'+(task.cwd.includes('\\')?win32.basename(task.cwd):basename(task.cwd))+'｜任务 '+input.task.replace(/^remote-/,'').slice(0,8)+'】';let seq=0,delivered=0,lastTurn,tail=Promise.resolve(),failure
 async function stage(item){
  if(item?.type!=='agentMessage'||!item.text||item.phase==='partial_answer')return
  const saved=offsets[item.id];if(saved&&saved.state!=='accepted')throw Error('REMOTE_STREAM_DELIVERY_UNCERTAIN')
  const prefix=item.text.slice(0,saved?.offset??0)
  if(saved&&(prefix.length!==saved.offset||digest(prefix)!==saved.hash))throw Error('REMOTE_STREAM_PREFIX_MISMATCH')
  const text=item.text.slice(prefix.length);if(!text)return
  if(Buffer.byteLength(text)>12000||/[\[\]`|~]|\/home\//.test(text)){pendingFinal.push(text);return}
  const entry={offset:item.text.length,hash:digest(item.text),state:'sending'}
  await controller.store.update(s=>{s[input.task].stream_offsets??={};s[input.task].stream_offsets[item.id]=entry})
  try{
   await (controller.relayText??relay)({scope:process.env.CODEX_THREAD_ID,task:input.task,seq:++seq,chunkId:digest(item.id+':'+prefix.length),text:label+'\n'+text})
   entry.state='accepted';await controller.store.update(s=>{s[input.task].stream_offsets[item.id]=entry});offsets[item.id]=entry;delivered++
  }catch(error){entry.state='unknown';await controller.store.update(s=>{s[input.task].stream_offsets[item.id]=entry});throw error}
 }
 return controller.usingTask(task,async rpc=>{
  rpc.onEvent=event=>{const p=event.params??{};if(p.threadId!==task.thread_id||p.turnId!==task.turn_id)return
   if(event.method==='item/completed'&&p.item?.phase==='commentary')tail=tail.then(()=>{if(!failure)return stage(p.item)}).catch(error=>{failure=error})
  }
  try{
   const end=Date.now()+(input.timeoutMs??120000)
   do{if(failure)throw failure;lastTurn=await controller.turns(rpc,task);if(!lastTurn||!['inProgress','in_progress'].includes(lastTurn.status))break;await delay(1000)}while(Date.now()<end)
   await tail;if(failure)throw failure
   const complete=!!lastTurn&&!['inProgress','in_progress'].includes(lastTurn.status)
   if(complete){for(const item of lastTurn.items??[])await stage(item);await stage({type:'agentMessage',id:'completion:'+task.turn_id,text:({completed:pendingFinal.length?'✅ 远程任务执行已完成，完整结果由主助手整理。':'✅ 远程任务已完成。',failed:'⚠️ 远程任务执行失败。',interrupted:'⏹ 远程任务已停止。'}[lastTurn.status]??'远程轮次已结束。')})}
   return {task:input.task,turn_status:lastTurn?.status??'unknown',streamed:delivered>0,stages:delivered,chunks:delivered,pending_final:pendingFinal,complete}
  }finally{rpc.onEvent=()=>{};await tail}
 })
}
