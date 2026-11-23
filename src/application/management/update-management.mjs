import {managementWrite} from './management-writes.mjs'
export async function checkUpdates(context,owner){
 if(!context.updates)throw Error('MANAGEMENT_UPDATE_UNAVAILABLE')
 const data=await context.updates.query()
 return {...data,updateToken:data.latest?context.sign({kind:'update',owner,version:data.latest.tag,expires:context.now()+600000}):null,upgradeScheduled:false}
}
export function skipUpdate(context,owner,caller,args){return managementWrite(context,owner,caller,'skip_update',args,async op=>{
 if(!context.updates)throw Error('MANAGEMENT_UPDATE_UNAVAILABLE')
 const token=context.credential(args.updateToken,'update',owner)
 const detail=await context.updates.skipVersion(owner,token.version)
 op.status='confirmed';op.data={version:token.version,skipped:true,newerVersionsUnaffected:true};op.detail=detail
})}
