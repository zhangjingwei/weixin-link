import {deliveryError,deliveryFailureState} from '../../core/delivery/delivery-error.mjs'

/** Retry a definitively rejected text final once after a fresh inbound message. */
export async function recoverFailedFinal(manager,key,deliver){
 const record=manager.state.users[key],recovery=record?.recovery
 if(recovery?.execution!=='completed'||recovery.delivery!=='failed'||recovery.delivery_error?.api_code!==-2||recovery.autoResend||!record.lastReply||record.lastOutput)return null
 const session=manager.sessions.get(key)
 if(session&&(session.busy||session.finishing||session.connecting))return null
 recovery.autoResend='sending'
 await manager.save()
 let status='unknown',errorDetail
 try{
  const result=await deliver(key,'上次回答补发：\n'+record.lastReply)
  if(['accepted','deferred','partial','unknown','failed'].includes(result?.status))status=result.status
 }catch(error){status=deliveryFailureState(error);errorDetail=deliveryError(error)}
 if(record.recovery===recovery){
  recovery.autoResend='attempted'
  recovery.delivery=status
  if(['accepted','deferred'].includes(status))delete recovery.delivery_error
  else if(errorDetail)recovery.delivery_error=errorDetail
  await manager.save()
 }
 return status
}
