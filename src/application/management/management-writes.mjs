import {createHash,randomUUID} from 'node:crypto'
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const operationSignature=(name,args)=>createHash('sha256').update(JSON.stringify([name,canonical(args)])).digest('hex')

// Keep audit/deduplication metadata, but no payload for a confirmed unexecuted request.
export function discardUnexecutedPayload(op){
 if(!['not_executed','rejected'].includes(op.status))return
 delete op.snapshot;delete op.packet;delete op.resultToken
}
export function pruneManagementOperations(operations,now){
 for(let i=operations.length-1;i>=0;i--){
  const op=operations[i];discardUnexecutedPayload(op)
  if(!['pending','executing','unknown'].includes(op.status)&&op.createdAt<now-7*86400000)operations.splice(i,1)
 }
}

// All extensions use the same state, restart policy and write identities as phase one.
export async function managementWrite(context,owner,caller,name,args,work){
 const signature=operationSignature(name,args),key=JSON.stringify([owner,args.requestId]),inflight=context.inflight.get(key)
 if(inflight){if(inflight.signature!==signature)throw Error('MANAGEMENT_REQUEST_CONFLICT');return inflight.work}
 const previous=context.operations.find(op=>op.owner===owner&&op.requestId===args.requestId)
 if(previous){if(previous.signature!==signature)throw Error('MANAGEMENT_REQUEST_CONFLICT');return context.result(previous)}
 const run=(async()=>{
  if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
  if(context.operations.some(op=>op.owner===owner&&['pending','executing'].includes(op.status)))throw Error('MANAGEMENT_OPERATION_PENDING')
  pruneManagementOperations(context.operations,context.now())
  if(context.operations.filter(op=>op.owner===owner).length>=10000)throw Error('MANAGEMENT_OPERATION_LIMIT')
  const op={id:randomUUID(),owner,caller,name,projectId:args.projectId??null,requestId:args.requestId,signature,status:'executing',createdAt:context.now()}
  context.operations.push(op)
  try{await context.manager.save()}catch(error){op.status='not_executed';throw error}
  try{if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE');await work(op)}catch(error){op.status=/^(?:MANAGEMENT|SCHEDULE|UPDATE)_[A-Z_]+$/.test(error.message)?'rejected':'unknown';op.detail=/^(?:MANAGEMENT|SCHEDULE|UPDATE)_[A-Z_]+$/.test(error.message)?error.message:'MANAGEMENT_OPERATION_UNCONFIRMED'}
  discardUnexecutedPayload(op)
  try{await context.manager.save()}catch{op.status='unknown';throw Error('MANAGEMENT_STATE_UNAVAILABLE')}
  if(op.status==='pending')context.expire(op)
  return context.result(op)
 })()
 context.inflight.set(key,{signature,work:run})
 try{return await run}finally{context.inflight.delete(key)}
}
