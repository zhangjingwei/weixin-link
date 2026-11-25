// Official Codex memory only. No local facts database or extraction protocol.
export const nativeMemoryConfig={'features.memories':true,'memories.generate_memories':true,'memories.use_memories':true}
export async function enableThreadMemory(rpc,threadId){await rpc.request('thread/memoryMode/set',{threadId,mode:'enabled'})}
