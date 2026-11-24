import {managementWrite} from './management-writes.mjs'

export async function maintenanceRead(context,owner,name,args){
 if(!context.maintenance)throw Error('MANAGEMENT_MAINTENANCE_UNAVAILABLE')
 const methods={get_service_status:'serviceStatus',get_installation_status:'installationStatus',get_diagnostics:'diagnostics',get_usage_guide:'guide',get_maintenance_status:'status'}
 const result=await context.maintenance[methods[name]](args.language??'zh')
 if(name==='get_service_status')return {...result,desktopPaused:!!context.manager.state.desktopHandoff}
 if(name!=='get_maintenance_status')return result
 return {...result,requests:context.operations.filter(op=>op.owner===owner&&['request_upgrade','request_service_restart'].includes(op.name)).slice(-10).map(op=>({...context.result(op),name:op.name,createdAt:op.createdAt}))}
}
export function requestMaintenance(context,owner,caller,name,args){return managementWrite(context,owner,caller,name,args,async op=>{
 if(!context.maintenance)throw Error('MANAGEMENT_MAINTENANCE_UNAVAILABLE')
 const dispatch=context.manager.submissions?.get(context.manager.sessions.get(caller)?.taskId??'')?.input?.projectDispatch
 if(dispatch&&!dispatch.entryOrigin)throw Error('MANAGEMENT_NESTED_MAINTENANCE_DENIED')
 if(name==='request_upgrade'){
  const token=context.credential(args.updateToken,'update',owner)
  if(! /^[0-9a-f]{40}$/.test(token.commit??''))throw Error('MANAGEMENT_CREDENTIAL_INVALID')
  op.release={tag:token.version,commit:token.commit}
 }
 op.status='pending';op.data={scope:name==='request_upgrade'?'installation':'current_account',...op.release?{version:op.release.tag}:{},completed:false}
})}
export async function executeMaintenance(context,op){
 op.status='executing';await context.manager.save()
 if(context.closed||!context.ready())throw Error('MANAGEMENT_UNAVAILABLE')
 const result=op.name==='request_upgrade'?await context.maintenance.upgrade(op.release):await context.maintenance.restart()
 if(!['scheduled','already_scheduled','blocked','up_to_date','not_executed'].includes(result?.status))throw Error('MAINTENANCE_RECEIPT_UNCONFIRMED')
 op.status=result.status;op.detail=result.reason??null;op.data={...op.data,...result,completed:false}
}
