const tools=new Set(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageGeneration','collabAgentToolCall'])
export function toolResultStatus(item,started){
 if(started)return 'running'
 if(item.failure||item.error||Number.isInteger(item.exitCode)&&item.exitCode!==0||['failed','error','declined'].includes(item.status))return 'failed'
 if(['cancelled','canceled','interrupted'].includes(item.status))return 'cancelled'
 return 'completed' // Called only for the official item/completed event.
}
export function createToolNotifier({send,serialize,track,recipient,log=()=>{}}){
 return async(session,item,started)=>{
  if(!tools.has(item?.type)||typeof item.id!=='string'||!item.id)return
  const token=session.workToken,thread=session.threadId,turn=session.turnId,peer=recipient(session.userId)
  const current=()=>token?.current()&&session.workToken===token&&session.threadId===thread&&session.turnId===turn&&session.busy&&!session.finalReceived
  if(!current())return
  const event={id:thread+':'+turn+':'+item.id,name:item.type,status:toolResultStatus(item,started),started}
  try{await track(()=>serialize(peer,async()=>{if(current())await send(peer,event)}))}catch{log('weixin.tool_status_unconfirmed',{kind:item.type})}
 }
}
