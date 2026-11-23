/** Parse an explicit-offset instant without JavaScript's calendar normalization. */
export function scheduleInstant(value){
 if(typeof value!=='string')throw Error('SCHEDULE_ARGUMENTS_INVALID')
 const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-](\d\d):(\d\d))$/.exec(value)
 if(!match)throw Error('SCHEDULE_ARGUMENTS_INVALID')
 const [,year,month,day,hour,minute,second,,offsetHour='0',offsetMinute='0']=match
 if(+month<1||+month>12||+day<1||+day>new Date(Date.UTC(+year,+month,0)).getUTCDate()||+hour>23||+minute>59||+second>59||+offsetHour>23||+offsetMinute>59)throw Error('SCHEDULE_TIME_INVALID')
 const at=Date.parse(value);if(!Number.isFinite(at))throw Error('SCHEDULE_TIME_INVALID')
 return at
}
