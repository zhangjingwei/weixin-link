import {accountPaths} from '../wechat/accounts.mjs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
const dir=join(accountPaths().stateDir,process.argv.includes('--integration')?'integration-logs':'logs')
const counts={},failures=[],active=new Map();let records=0,invalid=0,last=null,dropped=0
for(const file of ['events.jsonl.5','events.jsonl.4','events.jsonl.3','events.jsonl.2','events.jsonl.1','events.jsonl']){
 let data;try{data=await readFile(join(dir,file),'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
 for(const line of data.trim().split('\n').filter(Boolean)){
  let r;try{r=JSON.parse(line)}catch{invalid++;continue}
  records++;counts[r.event]=(counts[r.event]??0)+1;last=r.timestamp;dropped+=r.dropped??0
  if(r.event==='turn.started')active.set(r.trace_id,{trace_id:r.trace_id,started_at:r.timestamp})
  if(r.event==='turn.completed')active.delete(r.trace_id)
  if(r.event==='service.stopping'||r.event==='service.started')active.clear()
  if(r.event==='rpc.closed')for(const [id,item] of active)if(id===r.trace_id)active.delete(id)
  if(r.level==='error')failures.push({timestamp:r.timestamp,event:r.event,trace_id:r.trace_id,stage:r.stage,code:r.code,error_type:r.error_type,part:r.part})
 }
}
console.log(JSON.stringify({scope:'Local diagnostic events; send_accepted means API acceptance, not proof the recipient read it.',records,last_event_at:last,invalid_lines:invalid,dropped_records:dropped,counts,recent_failures:failures.slice(-20),unmatched_turns:[...active.values()]},null,2))
