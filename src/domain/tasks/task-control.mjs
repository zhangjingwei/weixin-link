// Task control accepts typed, identity-bound events. Assistant text is never an event.
export function waitingFor(control,{taskId,threadId,turnId}){
 return control&&!control.cancelled&&typeof taskId==='string'&&control.taskId===taskId&&control.threadId===threadId&&control.turnId===turnId&&['attachment','answer'].includes(control.waitingFor)?control.waitingFor:null
}
export function requestTaskInput(identity,kind){
 if(!['attachment','answer'].includes(kind)||['taskId','threadId','turnId'].some(key=>typeof identity[key]!=='string'||!identity[key]))throw Error('TASK_CONTROL_INVALID')
 return {...identity,waitingFor:kind}
}
export function turnExecution(status,control,identity){
 if(!['completed','failed','interrupted'].includes(status))return 'unknown'
 const waiting=status==='completed'?waitingFor(control,identity):null
 return waiting==='attachment'?'waiting_attachment':waiting==='answer'?'waiting_user':status
}
export function reportTaskResult(identity,outcome){
 if(!['completed','failed','blocked'].includes(outcome)||['taskId','threadId','turnId'].some(key=>typeof identity[key]!=='string'||!identity[key]))throw Error('TASK_CONTROL_INVALID')
 return {...identity,outcome}
}
// Turn completion and goal completion are different facts.
export function taskOutcome(status,control,identity,{handedOff=false}={}){
 if(!['completed','failed','interrupted'].includes(status))return 'unknown'
 if(status!=='completed')return status==='interrupted'?'cancelled':'failed'
 if(control?.cancelled===true&&control.taskId===identity.taskId&&control.threadId===identity.threadId&&control.turnId===identity.turnId)return 'cancelled'
 const wait=waitingFor(control,identity)
 if(wait)return wait==='attachment'?'waiting_attachment':'waiting_user'
 if(handedOff)return 'handed_off'
 return control&&control.taskId===identity.taskId&&control.threadId===identity.threadId&&control.turnId===identity.turnId&&['completed','failed','blocked'].includes(control.outcome)?control.outcome:'unknown'
}
export function outcomeEvidence(status,control,identity,options){
 const outcome=taskOutcome(status,control,identity,options)
 if(outcome==='handed_off')return 'management_receipt'
 if(outcome==='cancelled'&&control?.cancelled===true)return 'user_operation'
 if(['waiting_attachment','waiting_user'].includes(outcome))return 'task_control'
 if(status==='completed'&&['completed','failed','blocked'].includes(outcome))return 'agent_report'
 return 'execution_event'
}
