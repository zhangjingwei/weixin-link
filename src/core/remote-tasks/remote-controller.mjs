import {watchTask} from './remote-watch.mjs'
import {RemoteRpc} from './remote-task-client.mjs'
import {HOSTS} from '../../remote/remote-config.mjs'
import {RemoteStore} from './remote-store.mjs'
import {win32,posix,resolve,relative,isAbsolute,join,basename} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const hash=s=>createHash('sha256').update(s).digest('hex')
const hostPath=host=>HOSTS[host]?.platform==='win32'?win32:posix
export function projectPath(host,value){
 const {isAbsolute,resolve,relative,sep}=hostPath(host)
 if(!HOSTS[host]||typeof value!=='string'||!isAbsolute(value)||/[\0\r\n]/.test(value)||value.split(/[\\/]/).includes('..'))throw Error('INVALID_PROJECT')
 const path=resolve(value),rel=relative(HOSTS[host].root,path)
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||rel.split(sep).some(p=>p.startsWith('.')))throw Error('PROJECT_OUTSIDE_HOST_ROOT')
 return path
}
export function exportPath(cwd,value){const {resolve,relative,isAbsolute,basename,sep}=win32.isAbsolute(cwd)&&!posix.isAbsolute(cwd)?win32:posix;const path=resolve(value),rel=relative(cwd,path);if(!isAbsolute(value)||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||rel.split(sep).some(p=>p.startsWith('.'))||/^(?:credentials|secrets?|tokens?|private[-_]key)/i.test(basename(path)))throw Error('EXPORT_PATH_REFUSED');return path}
export class RemoteController{
 constructor({root,scope=process.env.CODEX_THREAD_ID??'local-console',rpcFactory=host=>new RemoteRpc(host)}={}){this.root=root;this.scope=hash(scope).slice(0,24);this.store=new RemoteStore(root);this.rpcFactory=rpcFactory}
 async usingTask(target,work){return this.using(target.host,work,{taskId:target.task_id??target.operation_id,threadId:target.thread_id,cwd:target.cwd})}
 async using(host,work,recovery){if(!HOSTS[host])throw Error('UNKNOWN_HOST');const rpc=this.rpcFactory(host);try{if(recovery?.threadId)rpc.setRecovery?.(recovery);await rpc.connect();return await work(rpc)}finally{rpc.close()}}
 async task(id){const task=(await this.store.read())[id];if(!task||task.kind!=='official-remote-task'||task.scope!==this.scope)throw Error('TASK_NOT_IN_CURRENT_CONVERSATION');projectPath(task.host,task.cwd);return {...task,task_id:id}}
 async target(input){if(input.task)return this.task(input.task);const saved=(await this.store.read())._routing?.[this.scope],host=input.host??saved?.host,cwd=projectPath(host,input.project??saved?.cwd);return {host,cwd,thread_id:input.host||input.project?undefined:saved?.thread_id}}
 async turns(rpc,task){let cursor;for(let n=0;n<20;n++){const page=await rpc.call('thread/turns/list',{threadId:task.thread_id,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});const found=page.data.find(t=>t.id===task.turn_id);if(found)return found;cursor=page.nextCursor;if(!cursor)break}return null}
 async terminals(rpc,threadId){const result=[];let cursor;for(let n=0;n<100;n++){const page=await rpc.call('thread/backgroundTerminals/list',{threadId,limit:100,...(cursor?{cursor}:{})});result.push(...page.data);cursor=page.nextCursor;if(!cursor)return result}throw Error('TERMINAL_LIST_INCOMPLETE')}
 async inspect(input){const target=await this.target(input);return this.usingTask(target,async rpc=>{
  if(!(await rpc.call('fs/getMetadata',{path:target.cwd})).isDirectory)throw Error('PROJECT_NOT_DIRECTORY')
  const {join,parse,sep}=hostPath(target.host);const instructions=[];const dirs=[];let ancestor=parse(target.cwd).root;dirs.push(ancestor);for(const part of target.cwd.slice(ancestor.length).split(sep).filter(Boolean)){ancestor=join(ancestor,part);dirs.push(ancestor)}
  for(const dir of dirs)try{const data=await rpc.call('fs/readFile',{path:join(dir,'AGENTS.md')});const bytes=Buffer.from(data.dataBase64,'base64');if(bytes.length>65536)throw Error('PROJECT_INSTRUCTIONS_TOO_LARGE');instructions.push({path:join(dir,'AGENTS.md'),text:bytes.toString('utf8')})}catch(e){if(e.message!=='REMOTE_RPC_ERROR')throw e}
  let codegraph=false;try{codegraph=(await rpc.call('fs/getMetadata',{path:join(target.cwd,'.codegraph')})).isDirectory}catch{}
  return {...target,instructions,codegraph}
 })}
 async select(input){const target=await this.inspect(input);await this.store.update(s=>{s._routing??={};s._routing[this.scope]={host:target.host,cwd:target.cwd,...(target.thread_id?{thread_id:target.thread_id}:{})}});return {selected:{host:target.host,project:target.cwd},instructions:target.instructions,codegraph:target.codegraph}}
 async list(input){const host=input.host??(await this.store.read())._routing?.[this.scope]?.host;if(input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>100))throw Error('INVALID_LIMIT');if(!host)throw Error('HOST_REQUIRED');return this.using(host,async rpc=>{
  const page=await rpc.call('thread/list',{limit:Math.min(input.limit??25,100),...(input.project?{cwd:projectPath(host,input.project)}:{}),...(input.cursor?{cursor:input.cursor}:{}),sourceKinds:['cli','appServer','exec','vscode']})
  return {host,sessions:page.data.filter(t=>{try{projectPath(host,t.cwd);return true}catch{return false}}).map(t=>({thread_id:t.id,name:t.name,project:t.cwd,status:t.status?.type})),next_cursor:page.nextCursor}
 })}
 async attach(input){const host=input.host;if(typeof input.threadId!=='string'||!input.threadId)throw Error('THREAD_REQUIRED');return this.using(host,async rpc=>{
  const thread=(await rpc.call('thread/read',{threadId:input.threadId})).thread,cwd=projectPath(host,thread.cwd)
  // Existing terminal sessions may be selected/read; stopping them requires a task explicitly submitted here.
  await this.store.update(s=>{s._routing??={};s._routing[this.scope]={host,cwd,thread_id:thread.id}});return {selected:{host,project:cwd,thread_id:thread.id},status:thread.status?.type}
 })}
 async start(input){return this.store.locked('scope-'+this.scope,async()=>{if((await this.store.read())._cancelled?.[this.scope])throw Error('REMOTE_SCOPE_STOPPED');return this.submit(input)})}
 async activate(){return this.store.locked('scope-'+this.scope,()=>this.store.update(s=>{if(s._cancelled)delete s._cancelled[this.scope];return {active:true}}))}
 async seal(){return this.store.locked('scope-'+this.scope,()=>this.store.update(s=>{s._cancelled??={};s._cancelled[this.scope]=new Date().toISOString();return {sealed:true}}))}
 async stopScope(){return this.store.locked('scope-'+this.scope,async()=>{
  await this.store.update(s=>{s._cancelled??={};s._cancelled[this.scope]=new Date().toISOString()})
  const records=Object.entries(await this.store.read()).filter(([,v])=>v?.kind==='official-remote-task'&&v.scope===this.scope&&!v.stop_confirmed).reverse(),results=[]
  for(const [id,record] of records){try{if(!record.turn_id){const reconciled=await this.reconcile({task:id});if(!reconciled.turn_id)throw Error('SUBMISSION_UNKNOWN_REQUIRE_RECONCILIATION')}results.push(await this.stop({task:id}))}catch(error){results.push({task:id,host:record.host,stop_confirmed:false,error:error.message})}}
  return {stop_confirmed:results.every(r=>r.stop_confirmed),tasks:results}
 })}
 async submit(input){
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>12000)throw Error('INVALID_PROMPT')
  const target=await this.target(input),lock='project-'+hash(target.host+'\0'+target.cwd).slice(0,32)
  return this.store.locked(lock,()=>this.usingTask(target,async rpc=>{
   let cursor;for(let n=0;n<100;n++){const page=await rpc.call('thread/list',{cwd:target.cwd,limit:100,sourceKinds:['cli','appServer','exec','vscode'],...(cursor?{cursor}:{})});if(page.data.some(t=>t.status?.type==='active'))throw Error('PROJECT_BUSY');cursor=page.nextCursor;if(!cursor)break;if(n===99)throw Error('PROJECT_BUSY_CHECK_INCOMPLETE')}
   let threadId=input.newThread?undefined:target.thread_id
   if(!threadId&&!input.newThread){const state=await this.store.read();const rows=Object.values(state).filter(t=>t?.kind==='official-remote-task'&&t.scope===this.scope&&t.host===target.host&&t.cwd===target.cwd);threadId=rows.at(-1)?.thread_id}
   if(threadId){const meta=(await rpc.call('thread/read',{threadId})).thread;if(meta.status?.type==='active')throw Error('THREAD_BUSY');if(meta.cwd!==target.cwd)throw Error('THREAD_PROJECT_MISMATCH');await rpc.call('thread/resume',{threadId,excludeTurns:true})}
   else{const result=await rpc.call('thread/start',{cwd:target.cwd,approvalPolicy:'never',sandbox:input.sandbox==='danger-full-access'?'danger-full-access':'workspace-write'});threadId=result.thread.id}
   const baseline=await this.terminals(rpc,threadId)
   const id='remote-'+randomUUID(),record={kind:'official-remote-task',scope:this.scope,host:target.host,cwd:target.cwd,thread_id:threadId,turn_id:null,operation_id:randomUUID(),submitted_at:new Date().toISOString(),transport:HOSTS[target.host].transport,local_ssh_pid:rpc.child?.pid,submission:'pending',terminal_baseline:baseline.map(t=>t.processId),owned_terminal_ids:[]}
   await this.store.update(s=>{s[id]=record})
   try{const result=await rpc.call('turn/start',{threadId,clientUserMessageId:record.operation_id,input:[{type:'text',text:input.prompt}]});record.turn_id=result.turn.id;record.submission='confirmed'}catch(error){record.submission='unknown';await this.store.update(s=>{s[id]=record});throw Object.assign(Error('SUBMISSION_UNCERTAIN_DO_NOT_RESUBMIT'),{task:id})}
   await this.store.update(s=>{s[id]=record;s._routing??={};s._routing[this.scope]={host:target.host,cwd:target.cwd,thread_id:threadId,task:id}})
   return {task:id,host:target.host,project:target.cwd,thread_id:threadId,turn_id:record.turn_id,status:'submitted'}
  }))
 }
 async reconcile(input){const target=await this.task(input.task);if(target.turn_id)return {task:input.task,turn_id:target.turn_id,submission:target.submission};return this.usingTask(target,async rpc=>{
  let cursor;for(let n=0;n<20;n++){const page=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});const turn=page.data.find(t=>(t.items??[]).some(i=>i.type==='userMessage'&&i.clientId===target.operation_id));if(turn){await this.store.update(s=>{s[input.task].turn_id=turn.id;s[input.task].submission='confirmed'});return {task:input.task,turn_id:turn.id,submission:'confirmed'}}cursor=page.nextCursor;if(!cursor)break}return {task:input.task,submission:'unknown',resubmit_allowed:false}
 })}
 async status(input){const target=await this.task(input.task);return this.usingTask(target,async rpc=>{
  const thread=(await rpc.call('thread/read',{threadId:target.thread_id})).thread
  const turn=target.turn_id?await this.turns(rpc,target):null
  const terminals=await this.terminals(rpc,target.thread_id);const latest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});if(latest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline)){const owned=terminals.filter(t=>!target.terminal_baseline.includes(t.processId)).map(t=>t.processId);if(owned.length)await this.store.update(s=>{s[input.task].owned_terminal_ids=[...new Set([...(s[input.task].owned_terminal_ids??[]),...owned])]})}
  return {task:input.task,host:target.host,project:target.cwd,thread_id:target.thread_id,turn_id:target.turn_id,thread_status:thread.status?.type,turn_status:turn?.status??'unknown',submission:target.submission,background_commands:terminals.filter(t=>(target.owned_terminal_ids??[]).includes(t.processId)||Array.isArray(target.terminal_baseline)&&latest.data[0]?.id===target.turn_id&&!target.terminal_baseline.includes(t.processId)).map(t=>({process_id:t.processId,command:t.command})),commands:(turn?.items??[]).filter(i=>i.type==='commandExecution').map(i=>({id:i.id,command:i.command,status:i.status,exit_code:i.exitCode})),error:turn?.error??null,answer:(turn?.items??[]).filter(i=>i.type==='agentMessage').map(i=>({phase:i.phase,text:i.text?.slice(0,16000)}))}
 })}
 async stop(input){const target=await this.task(input.task);if(!target.turn_id)throw Error('SUBMISSION_UNKNOWN_REQUIRE_RECONCILIATION')
  return this.store.locked('project-'+hash(target.host+'\0'+target.cwd).slice(0,32),()=>this.usingTask(target,async rpc=>{
   await rpc.call('thread/resume',{threadId:target.thread_id,excludeTurns:true});let turn=await this.turns(rpc,target)
   if(!turn)throw Error('TARGET_TURN_NOT_FOUND')
   const before=await this.terminals(rpc,target.thread_id),latest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});const tracked=new Set(target.owned_terminal_ids??[]);if(latest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline))for(const terminal of before)if(!target.terminal_baseline.includes(terminal.processId))tracked.add(terminal.processId);await this.store.update(s=>{s[input.task].owned_terminal_ids=[...tracked]})
   if(['inProgress','in_progress'].includes(turn.status)){
    await rpc.call('turn/interrupt',{threadId:target.thread_id,turnId:target.turn_id})
    for(let n=0;n<50;n++){turn=await this.turns(rpc,target);if(turn&&!['inProgress','in_progress'].includes(turn.status))break;await delay(100)}
   }
   if(!turn||['inProgress','in_progress'].includes(turn.status))throw Error('STOP_NOT_CONFIRMED')
   const itemIds=new Set((turn.items??[]).filter(i=>i.type==='commandExecution').map(i=>i.id)),terminals=[];let cursor
   do{const page=await rpc.call('thread/backgroundTerminals/list',{threadId:target.thread_id,limit:100,...(cursor?{cursor}:{})});terminals.push(...page.data);cursor=page.nextCursor}while(cursor)
   const afterLatest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});if(afterLatest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline)){for(const terminal of terminals)if(!target.terminal_baseline.includes(terminal.processId))tracked.add(terminal.processId);await this.store.update(s=>{s[input.task].owned_terminal_ids=[...tracked]})}
   if(afterLatest.data[0]?.id!==target.turn_id&&Array.isArray(target.terminal_baseline)&&terminals.some(t=>!target.terminal_baseline.includes(t.processId)&&!itemIds.has(t.itemId)&&!tracked.has(t.processId)))throw Error('COMMAND_OWNERSHIP_UNCONFIRMED');const owned=terminals.filter(t=>itemIds.has(t.itemId)||tracked.has(t.processId));for(const terminal of owned)await rpc.call('thread/backgroundTerminals/terminate',{threadId:target.thread_id,processId:terminal.processId})
   for(let n=0;n<30;n++){const remaining=[];let next;do{const page=await rpc.call('thread/backgroundTerminals/list',{threadId:target.thread_id,limit:100,...(next?{cursor:next}:{})});remaining.push(...page.data);next=page.nextCursor}while(next);if(!remaining.some(t=>itemIds.has(t.itemId)||tracked.has(t.processId))){const confirmed={task:input.task,host:target.host,turn_status:turn.status,commands_terminated:owned.length,stop_confirmed:true};await this.store.update(s=>{s[input.task].stop_confirmed=true;s[input.task].stopped_at=new Date().toISOString();s[input.task].stop_result=confirmed});return confirmed;}await delay(100)}
   throw Error('COMMAND_STOP_NOT_CONFIRMED')
  }))
 }
 async fetch(input){const target=await this.task(input.task),path=exportPath(target.cwd,input.path);return this.usingTask(target,async rpc=>{
  const {relative,join,sep,basename}=hostPath(target.host);const rel=relative(target.cwd,path);let current=target.cwd
  for(const part of ['',...rel.split(sep)]){if(part)current=join(current,part);const info=await rpc.call('fs/getMetadata',{path:current});if(info.isSymlink)throw Error('EXPORT_SYMLINK_REFUSED')}
  const result=await rpc.call('fs/readFile',{path},60000);if(result.dataBase64.length>70*1024*1024)throw Error('ARTIFACT_TOO_LARGE');const bytes=Buffer.from(result.dataBase64,'base64');if(!bytes.length||bytes.length>50*1024*1024)throw Error('ARTIFACT_TOO_LARGE')
  const dir=join(this.root,'outputs','remote',input.task);await mkdir(dir,{recursive:true,mode:0o700});const dest=join(dir,hash(bytes).slice(0,16)+'-'+basename(path));await writeFile(dest,bytes,{mode:0o600});return {task:input.task,host:target.host,path:dest,bytes:bytes.length,sha256:hash(bytes)}
 })}
 async run(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_INPUT');const actions={watch:()=>watchTask(this,input),seal:()=>this.seal(),'stop-scope':()=>this.stopScope(),activate:()=>this.activate(),reconcile:()=>this.reconcile(input),inspect:()=>this.inspect(input),select:()=>this.select(input),list:()=>this.list(input),attach:()=>this.attach(input),start:()=>this.start(input),send:()=>this.start(input),status:()=>this.status(input),result:()=>this.status(input),stop:()=>this.stop(input),fetch:()=>this.fetch(input)};if(!actions[input.action])throw Error('UNKNOWN_ACTION');return actions[input.action]()}
}
