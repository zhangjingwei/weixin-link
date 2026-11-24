// Codex semantics live here; connection code must not decide which writes to replay.
const READ_ONLY=new Set(['account/usage/read','account/rateLimits/read','threadSection/list','thread/queue/list','thread/goal/get','project/list','project/read','thread/read','thread/list','thread/search','thread/searchOccurrences','thread/turns/list','thread/backgroundTerminals/list','fs/getMetadata','fs/readFile'])
export const isReadOnlyCodexMethod=method=>READ_ONLY.has(method)
export async function initializeCodex(rpc,clientInfo){
 const request=rpc.request??rpc.call
 await request.call(rpc,'initialize',{clientInfo,capabilities:{experimentalApi:true}})
 rpc.write({method:'initialized',params:{}})
}
