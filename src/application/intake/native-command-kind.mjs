/** Classify native commands that need a durable ingress before cursor checkpoint. */
export function nativeCommandKind(intent){
 if(intent?.kind!=='session')return null
 const {action,op}=intent.value??{}
 if(action==='plan'||action==='review'||action==='reviewCommit')return 'task'
 if(action==='goal'&&!['get','invalidBudget'].includes(op)||['compact','fork','fast'].includes(action))return 'mutation'
 return null
}
