import {createHash} from 'node:crypto'

/** Record a fragment only after the outbound transport reports acceptance. */
export function createRemoteProgressDelivery({findSession,verifyTask,deliver,limit=1000}){
 const accepted=new Map(),inFlight=new Map(),uncertain=new Set()
 return async ({scope,task,seq,chunkId,text})=>{
  if(typeof scope!=='string'||typeof task!=='string'||!Number.isSafeInteger(seq)||seq<1||typeof text!=='string'||text.length>6000)throw Error('Invalid progress')
  if(typeof chunkId!=='string'||!/^[a-f0-9]{64}$/.test(chunkId))throw Error('Invalid chunk')
  const session=findSession(scope)
  if(!session?.busy||session.exited||!(session.workToken?.current()??false))throw Error('Inactive scope')
  await verifyTask(scope,task)
  const key=JSON.stringify([scope,task,chunkId]),hash=createHash('sha256').update(text).digest('hex')
  const confirmed=accepted.get(key)
  if(confirmed){
   if(confirmed!==hash)throw Error('REMOTE_PROGRESS_ID_CONFLICT')
   return {accepted:true,duplicate:true}
  }
  if(uncertain.has(key))throw Error('REMOTE_PROGRESS_DELIVERY_UNCERTAIN')
  const pending=inFlight.get(key)
  if(pending){
   if(pending.hash!==hash)throw Error('REMOTE_PROGRESS_ID_CONFLICT')
   await pending.promise
   return {accepted:true,duplicate:true}
  }
  const promise=(async()=>{
   const sent=await deliver(session,text,()=>session.busy&&(session.workToken?.current()??false))
   if(!sent)throw Error('Delivery not confirmed')
   if(accepted.size>=limit)accepted.delete(accepted.keys().next().value)
   accepted.set(key,hash)
  })()
  inFlight.set(key,{hash,promise})
  try{await promise;return {accepted:true}}
  catch(error){uncertain.add(key);throw error}
  finally{inFlight.delete(key)}
 }
}
