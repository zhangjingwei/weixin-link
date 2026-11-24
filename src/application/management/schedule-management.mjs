import {managementWrite} from './management-writes.mjs'
function requireSchedules(context){if(!context.schedules)throw Error('MANAGEMENT_SCHEDULE_UNAVAILABLE');return context.schedules}
function publicSchedule(context,owner,value){
 const {conversationKey,...job}=value,entry=context.entries(owner).find(e=>e.key===conversationKey)
 return {...job,projectId:entry?.id??null,projectName:entry?.name??null,targetAvailable:!!entry&&!entry.archived}
}
export function listSchedules(context,owner,args){
 const page=requireSchedules(context).list(owner,{offset:args.offset??0,limit:args.limit??10})
 return {...page,items:page.items.map(item=>publicSchedule(context,owner,item)),serverTime:new Date(context.now()).toISOString(),serverTimeZone:context.timeZone}
}
export function createSchedule(context,owner,caller,args){return managementWrite(context,owner,caller,'create_schedule',args,async op=>{
 const entry=context.target(owner,args.projectId)
 if(entry.archived||entry.archiveIntent!==undefined||entry.archiveSync==='missing')throw Error('MANAGEMENT_TARGET_UNAVAILABLE')
 const timeZone=args.timeZone??args.repeat?.timeZone??context.timeZone
 try{new Intl.DateTimeFormat('en-US',{timeZone}).format()}catch{throw Error('MANAGEMENT_INVALID_TIME_ZONE')}
 if(args.repeat&&args.timeZone&&args.timeZone!==args.repeat.timeZone)throw Error('MANAGEMENT_INVALID_TIME_ZONE')
 const result=await requireSchedules(context).create(owner,{kind:args.kind,text:args.text,...args.at?{at:args.at}:{},...args.repeat?{repeat:args.repeat}:{}},entry.key,{requestId:args.requestId,timeZone})
 op.status='confirmed';op.data={...publicSchedule(context,owner,result),timeZone,localTime:new Intl.DateTimeFormat('sv-SE',{timeZone,dateStyle:'short',timeStyle:'long'}).format(new Date(result.at)),executed:false}
})}
export function cancelSchedule(context,owner,caller,args){return managementWrite(context,owner,caller,'cancel_schedule',args,async op=>{
 const result=await requireSchedules(context).cancel(owner,args.scheduleId)
 op.status='confirmed';op.data={...publicSchedule(context,owner,result),futureTriggersCancelled:result.status==='cancelled',taskMayStillBeRunning:!!(result.kind==='task'&&(result.submissionId||result.lastTrigger?.submissionId||result.status==='unknown')),runningTaskStopped:false}
})}
