import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const hash=s=>createHash('sha256').update(s).digest('hex')
export async function stopScope(context){return context.store.locked('scope-'+context.scope,async()=>{
  await context.store.update(s=>{s._cancelled??={};s._cancelled[context.scope]=new Date().toISOString()})
  const records=Object.entries(await context.store.read()).filter(([,v])=>v?.kind==='official-remote-task'&&v.scope===context.scope&&!v.stop_confirmed).reverse(),results=[]
  for(const [id,record] of records){try{if(!record.turn_id){const reconciled=await context.reconcile({task:id});if(!reconciled.turn_id)throw Error('SUBMISSION_UNKNOWN_REQUIRE_RECONCILIATION')}results.push(await context.stop({task:id}))}catch(error){results.push({task:id,host:record.host,stop_confirmed:false,error:error.message})}}
  return {stop_confirmed:results.every(r=>r.stop_confirmed),tasks:results}
 })}

export async function stop(context,input){const target=await context.task(input.task);if(!target.turn_id)throw Error('SUBMISSION_UNKNOWN_REQUIRE_RECONCILIATION')
  return context.store.locked('project-'+hash(target.host+'\0'+target.cwd).slice(0,32),()=>context.usingTask(target,async rpc=>{
   await rpc.call('thread/resume',{threadId:target.thread_id,excludeTurns:true});let turn=await context.turns(rpc,target)
   if(!turn)throw Error('TARGET_TURN_NOT_FOUND')
   const before=await context.terminals(rpc,target.thread_id),latest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});const tracked=new Set(target.owned_terminal_ids??[]);if(latest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline))for(const terminal of before)if(!target.terminal_baseline.includes(terminal.processId))tracked.add(terminal.processId);await context.store.update(s=>{s[input.task].owned_terminal_ids=[...tracked]})
   if(['inProgress','in_progress'].includes(turn.status)){
    await rpc.call('turn/interrupt',{threadId:target.thread_id,turnId:target.turn_id})
    for(let n=0;n<50;n++){turn=await context.turns(rpc,target);if(turn&&!['inProgress','in_progress'].includes(turn.status))break;await delay(100)}
   }
   if(!turn||['inProgress','in_progress'].includes(turn.status))throw Error('STOP_NOT_CONFIRMED')
   const itemIds=new Set((turn.items??[]).filter(i=>i.type==='commandExecution').map(i=>i.id)),terminals=[];let cursor
   do{const page=await rpc.call('thread/backgroundTerminals/list',{threadId:target.thread_id,limit:100,...(cursor?{cursor}:{})});terminals.push(...page.data);cursor=page.nextCursor}while(cursor)
   const afterLatest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});if(afterLatest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline)){for(const terminal of terminals)if(!target.terminal_baseline.includes(terminal.processId))tracked.add(terminal.processId);await context.store.update(s=>{s[input.task].owned_terminal_ids=[...tracked]})}
   if(afterLatest.data[0]?.id!==target.turn_id&&Array.isArray(target.terminal_baseline)&&terminals.some(t=>!target.terminal_baseline.includes(t.processId)&&!itemIds.has(t.itemId)&&!tracked.has(t.processId)))throw Error('COMMAND_OWNERSHIP_UNCONFIRMED');const owned=terminals.filter(t=>itemIds.has(t.itemId)||tracked.has(t.processId));for(const terminal of owned)await rpc.call('thread/backgroundTerminals/terminate',{threadId:target.thread_id,processId:terminal.processId})
   for(let n=0;n<30;n++){const remaining=[];let next;do{const page=await rpc.call('thread/backgroundTerminals/list',{threadId:target.thread_id,limit:100,...(next?{cursor:next}:{})});remaining.push(...page.data);next=page.nextCursor}while(next);if(!remaining.some(t=>itemIds.has(t.itemId)||tracked.has(t.processId))){const confirmed={task:input.task,host:target.host,turn_status:turn.status,commands_terminated:owned.length,stop_confirmed:true};await context.store.update(s=>{s[input.task].stop_confirmed=true;s[input.task].stopped_at=new Date().toISOString();s[input.task].stop_result=confirmed});return confirmed;}await delay(100)}
   throw Error('COMMAND_STOP_NOT_CONFIRMED')
  }))
 }
