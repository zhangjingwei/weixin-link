import {remoteWorkspace} from '../../remote/remote-paths.mjs'
import {RemoteController} from '../../core/remote-tasks/remote-controller.mjs'
import {RemoteRpc} from '../../core/remote-tasks/remote-task-client.mjs'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
const host=process.argv[2];if(!host||!process.argv[3])throw Error('HOST_REQUIRED')
const root=remoteWorkspace,project=process.argv[3],scope='full-stop-'+host+'-'+randomUUID(),c=new RemoteController({root,scope}),guard=new RemoteController({root,scope:scope+'-guard'}),report={host,scope,checks:[]};let main,guardTask
async function waitCommand(controller,task){for(let n=0;n<80;n++){const s=await controller.status({task});if(s.background_commands.length||s.commands.some(v=>v.status==='inProgress'))return s;if(['failed','completed'].includes(s.turn_status))throw Error('COMMAND_NOT_RUNNING');await delay(500)}throw Error('COMMAND_START_TIMEOUT')}
try{
 main=await c.start({host,project,newThread:true,prompt:"Isolated full-stop test: execute exactly sh -c 'sleep 180 & wait' and wait for completion. Do not run other commands."});report.main=main;await waitCommand(c,main.task)
 const rpc=await new RemoteRpc(host).connect();try{const t=await rpc.call('thread/start',{cwd:project,approvalPolicy:'never',sandbox:'workspace-write'}),id='remote-'+randomUUID(),record={kind:'official-remote-task',scope:guard.scope,host,cwd:project,thread_id:t.thread.id,turn_id:null,operation_id:randomUUID(),terminal_baseline:[],owned_terminal_ids:[],submission:'pending',purpose:'full-stop-isolation-guard'};await guard.store.update(s=>{s[id]=record});const turn=await rpc.call('turn/start',{threadId:t.thread.id,clientUserMessageId:record.operation_id,input:[{type:'text',text:'Isolated guard test: run exactly sleep 181 and wait. Do not run other commands.'}]});record.turn_id=turn.turn.id;record.submission='confirmed';await guard.store.update(s=>{s[id]=record});guardTask=id;report.guard_task=id}finally{rpc.close()}
 await waitCommand(guard,guardTask);report.checks.push('both-owned-and-guard-commands-running')
 report.stop=await c.stopScope();if(!report.stop.stop_confirmed)throw Error('FULL_STOP_NOT_CONFIRMED');report.checks.push('scope-stop-confirmed')
 const mainStatus=await c.status({task:main.task});if(mainStatus.turn_status!=='interrupted'||mainStatus.background_commands.length)throw Error('OWN_TASK_NOT_STOPPED');report.checks.push('owned-turn-and-terminals-stopped')
 const guardStatus=await guard.status({task:guardTask});if(guardStatus.turn_status!=='inProgress'||!guardStatus.background_commands.length)throw Error('GUARD_WAS_INTERRUPTED');report.checks.push('other-conversation-still-running')
 const again=await c.stopScope();if(!again.stop_confirmed)throw Error('REPEATED_STOP_FAILED');report.checks.push('repeated-stop-idempotent')
 try{await c.start({host,project,prompt:'Late queued message must not start'});throw Error('LATE_TASK_ACCEPTED')}catch(e){if(e.message!=='REMOTE_SCOPE_STOPPED')throw e}report.checks.push('late-submission-blocked');report.ok=true
}catch(e){report.ok=false;report.error=e.message}
finally{if(guardTask)try{report.guard_cleanup=await guard.stopScope()}catch(e){report.guard_cleanup_error=e.message}if(main)try{report.main_cleanup=await c.stopScope()}catch(e){report.main_cleanup_error=e.message};await writeFile(root+'outputs/full-stop-'+host+'-verification.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1}
