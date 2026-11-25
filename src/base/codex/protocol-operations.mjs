export async function initializeCodex(rpc,clientInfo){
 const request=rpc.request??rpc.call
 await request.call(rpc,'initialize',{clientInfo,capabilities:{experimentalApi:true}})
 rpc.write({method:'initialized',params:{}})
}
