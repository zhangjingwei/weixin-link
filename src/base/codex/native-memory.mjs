// Official Codex memory only. No local facts database or extraction protocol.
export const nativeMemoryConfig={'features.memories':true,'memories.generate_memories':true,'memories.use_memories':true}
export function memoryCommand(text){
 const chinese=text.trim().replace(/[。！!]$/,'');if(chinese==='开启记忆'||chinese==='关闭记忆')return {action:'memory',op:'auto',on:chinese==='开启记忆'};if(chinese==='查看记忆')return {action:'memory',op:'list'}
 const arg=text.trim().match(/^\/memory(?:\s+(.*))?$/s)
 if(arg){const value=(arg[1]??'').trim();if(!value||value==='list')return {action:'memory',op:'list'};if(value==='auto on'||value==='auto off')return {action:'memory',op:'auto',on:value==='auto on'};return {action:'memory',op:'unsupported'}}
 if(/^(?:忘掉|删除)第?\s*\d+\s*条记忆[。！!]?$/u.test(text.trim())||/^把第?\s*\d+\s*条记忆改(?:为|成)/u.test(text.trim()))return {action:'memory',op:'unsupported'}
 return null
}
// Display-only compatibility for old persisted replies; never parses or saves candidates.
export const publicMemoryText=text=>String(text??'').replace(/<wechat-memory:([^>]+)>[\s\S]*?<\/wechat-memory:\1>/g,'').trim()
export async function enableThreadMemory(rpc,threadId){await rpc.request('thread/memoryMode/set',{threadId,mode:'enabled'})}
