import {createHash,randomUUID} from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
export async function start(context,input){return context.store.locked('scope-'+context.scope,async()=>{if((await context.store.read())._cancelled?.[context.scope])throw Error('REMOTE_SCOPE_STOPPED');return context.submit(input)})}

export async function submit(context,input){return context.store.locked('host-config',()=>{context.assertCurrentHosts();return context.submitWithConfig(input)})}

export async function submitWithConfig(context,input){
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>12000)throw Error('INVALID_PROMPT')
  const target=await context.target(input),lock='project-'+hash(target.host+'\0'+target.cwd).slice(0,32)
  return context.store.locked(lock,()=>context.usingTask(target,async rpc=>{
   let cursor;for(let n=0;n<100;n++){const page=await rpc.listSessions({cwd:target.cwd,limit:100,cursor});if(page.sessions.some(t=>t.status?.type==='active'))throw Error('PROJECT_BUSY');cursor=page.nextCursor;if(!cursor)break;if(n===99)throw Error('PROJECT_BUSY_CHECK_INCOMPLETE')}
   let threadId=input.newThread?undefined:target.thread_id
   if(!threadId&&!input.newThread){const state=await context.store.read();const rows=Object.values(state).filter(t=>t?.kind==='official-remote-task'&&t.scope===context.scope&&t.host===target.host&&t.cwd===target.cwd);threadId=rows.at(-1)?.thread_id}
   if(threadId){const meta=await rpc.readSession(threadId);if(meta.status?.type==='active')throw Error('THREAD_BUSY');if(meta.cwd!==target.cwd)throw Error('THREAD_PROJECT_MISMATCH');await rpc.resumeSession(threadId)}
   else{threadId=(await rpc.startSession({cwd:target.cwd,sandbox:input.sandbox})).id}
   const baseline=await context.terminals(rpc,threadId)
   const id='remote-'+randomUUID(),record={kind:'official-remote-task',scope:context.scope,account:context.account,host:target.host,cwd:target.cwd,thread_id:threadId,turn_id:null,operation_id:randomUUID(),submitted_at:new Date().toISOString(),transport:context.hosts[target.host].transport,local_ssh_pid:rpc.child?.pid,submission:'pending',terminal_baseline:baseline.map(t=>t.processId),owned_terminal_ids:[]}
   await context.store.update(s=>{s[id]=record})
   try{record.turn_id=(await rpc.startTurn(threadId,record.operation_id,input.prompt)).id;record.submission='confirmed'}catch(error){record.submission='unknown';await context.store.update(s=>{s[id]=record});throw Object.assign(Error('SUBMISSION_UNCERTAIN_DO_NOT_RESUBMIT'),{task:id})}
   await context.store.update(s=>{s[id]=record;s._routing??={};s._routing[context.scope]={host:target.host,cwd:target.cwd,thread_id:threadId,task:id}})
   return {task:id,host:target.host,project:target.cwd,thread_id:threadId,turn_id:record.turn_id,status:'submitted'}
  }))
 }

export async function reconcile(context,input){const target=await context.task(input.task);if(target.turn_id)return {task:input.task,turn_id:target.turn_id,submission:target.submission};return context.usingTask(target,async rpc=>{
  const turn=await rpc.findTurn(target.thread_id,{operationId:target.operation_id});if(turn){await context.store.update(s=>{s[input.task].turn_id=turn.id;s[input.task].submission='confirmed'});return {task:input.task,turn_id:turn.id,submission:'confirmed'}}return {task:input.task,submission:'unknown',resubmit_allowed:false}
 })}
