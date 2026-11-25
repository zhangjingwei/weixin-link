// A live service is not evidence that a particular turn is still executing.
export function taskProgress(session,now=Date.now()){
 if(!session)return null
 const waiting=session.nativeActiveFlags?.length||session.waitingAttachment||session.waitingUser
 const phase=waiting?'waiting':session.finalReceived||session.state==='delivering'?'delivering':session.state==='stopping'?'stopping':session.busy?
  session.executionEvidenceAt!=null&&now-session.executionEvidenceAt<=90_000?'running':'unknown':'idle'
 return {phase,startedAt:session.progressStartedAt??session.startedAt??null,confirmedAt:session.executionEvidenceAt??null,
  summary:session.lastProgress?.turnId===session.turnId?session.lastProgress?.text??null:null}
}
export function heartbeatDue(session,now=Date.now()){
 if(!session.busy||session.finalReceived||session.waitingAttachment||session.waitingUser||session.nativeActiveFlags?.length||session.state==='stopping'||session.exiting||session.rpcAttempt?.closing||session.workToken?.current()===false)return false
 const progress=session.lastUserNoticeAt??session.progressStartedAt??now
 const previous=session.lastWaitNoticeAt
 return now-progress>=180_000&&(!previous||now-previous>=300_000)
}
