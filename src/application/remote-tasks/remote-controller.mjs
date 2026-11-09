import {start,submit,submitWithConfig,reconcile} from './submission.mjs'
import {stopScope,stop} from './stopping.mjs'
import {fetch} from './artifacts.mjs'
import {watchTask} from './remote-watch.mjs'
import {RemoteRpc} from '../../infrastructure/agents/remote-rpc.mjs'
import {hostSnapshot} from '../../infrastructure/remote/host-config.mjs'
import {RemoteStore} from '../../infrastructure/storage/registry-lock.mjs'
import {isAbsolute,join,win32,posix} from 'node:path'
import {createHash} from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
const hostPath=(hosts,host)=>hosts[host]?.platform==='win32'?win32:posix
import {projectPath} from '../../infrastructure/remote/path-guard.mjs'
export {projectPath,exportPath} from '../../infrastructure/remote/path-guard.mjs'
export class RemoteController{
 constructor({root,scope=process.env.CODEX_THREAD_ID??'local-console',hosts,configPath,rpcFactory}={}){if(typeof root!=='string'||!isAbsolute(root))throw Error('INVALID_REMOTE_WORKSPACE');this.root=root;this.scope=hash(scope).slice(0,24);this.store=new RemoteStore(root);this.configPath=configPath??process.env.WECHAT_REMOTE_HOSTS??join(root,'remote-hosts.json');this.hosts=hostSnapshot({path:this.configPath,hosts});this.rpcFactory=rpcFactory??((host,config)=>new RemoteRpc(host,{hostConfig:config}))}
 assertCurrentHosts(){if(JSON.stringify(this.hosts)!==JSON.stringify(hostSnapshot({path:this.configPath})))throw Error('REMOTE_HOST_CONFIG_CHANGED')}
 projectPath(host,value){return projectPath(host,value,this.hosts)}
 hostPath(host){return hostPath(this.hosts,host)}
 async verifyProject(rpc,host,cwd){
  this.projectPath(host,cwd)
  const {root}=this.hosts[host],{relative,join,sep}=this.hostPath(host)
  let path=root
  for(const part of ['',...relative(root,cwd).split(sep).filter(Boolean)]){
   if(part)path=join(path,part)
   const info=await rpc.call('fs/getMetadata',{path})
   if(info.isSymlink)throw Error('PROJECT_SYMLINK_REFUSED')
   if(!info.isDirectory)throw Error('PROJECT_NOT_DIRECTORY')
  }
 }
 async usingTask(target,work){return this.using(target.host,async rpc=>{await this.verifyProject(rpc,target.host,target.cwd);return work(rpc)},{taskId:target.task_id??target.operation_id,threadId:target.thread_id,cwd:target.cwd})}
 async using(host,work,recovery){if(!this.hosts[host])throw Error('UNKNOWN_HOST');const rpc=this.rpcFactory(host,this.hosts[host]);try{if(recovery?.threadId)rpc.setRecovery?.(recovery);await rpc.connect();return await work(rpc)}finally{rpc.close()}}
 async task(id){const task=(await this.store.read())[id];if(!task||task.kind!=='official-remote-task'||task.scope!==this.scope)throw Error('TASK_NOT_IN_CURRENT_CONVERSATION');this.projectPath(task.host,task.cwd);return {...task,task_id:id}}
 async target(input){if(input.task)return this.task(input.task);const saved=(await this.store.read())._routing?.[this.scope],host=input.host??saved?.host,cwd=this.projectPath(host,input.project??saved?.cwd);return {host,cwd,thread_id:input.host||input.project?undefined:saved?.thread_id}}
 async turns(rpc,task){let cursor;for(let n=0;n<20;n++){const page=await rpc.call('thread/turns/list',{threadId:task.thread_id,limit:25,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});const found=page.data.find(t=>t.id===task.turn_id);if(found)return found;cursor=page.nextCursor;if(!cursor)break}return null}
 async terminals(rpc,threadId){const result=[];let cursor;for(let n=0;n<100;n++){const page=await rpc.call('thread/backgroundTerminals/list',{threadId,limit:100,...(cursor?{cursor}:{})});result.push(...page.data);cursor=page.nextCursor;if(!cursor)return result}throw Error('TERMINAL_LIST_INCOMPLETE')}
 async inspect(input){const target=await this.target(input);return this.usingTask(target,async rpc=>{
  if(!(await rpc.call('fs/getMetadata',{path:target.cwd})).isDirectory)throw Error('PROJECT_NOT_DIRECTORY')
  const {join,relative,sep}=this.hostPath(target.host);const instructions=[];const dirs=[];let ancestor=this.hosts[target.host].root;dirs.push(ancestor);for(const part of relative(ancestor,target.cwd).split(sep).filter(Boolean)){ancestor=join(ancestor,part);dirs.push(ancestor)}
  for(const dir of dirs)try{const data=await rpc.call('fs/readFile',{path:join(dir,'AGENTS.md')});const bytes=Buffer.from(data.dataBase64,'base64');if(bytes.length>65536)throw Error('PROJECT_INSTRUCTIONS_TOO_LARGE');instructions.push({path:join(dir,'AGENTS.md'),text:bytes.toString('utf8')})}catch(e){if(e.message!=='REMOTE_RPC_ERROR')throw e}
  let codegraph=false;try{codegraph=(await rpc.call('fs/getMetadata',{path:join(target.cwd,'.codegraph')})).isDirectory}catch{}
  return {...target,instructions,codegraph}
 })}
 async select(input){const target=await this.inspect(input);await this.store.update(s=>{s._routing??={};s._routing[this.scope]={host:target.host,cwd:target.cwd,...(target.thread_id?{thread_id:target.thread_id}:{})}});return {selected:{host:target.host,project:target.cwd},instructions:target.instructions,codegraph:target.codegraph}}
 async list(input){const host=input.host??(await this.store.read())._routing?.[this.scope]?.host;if(input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>100))throw Error('INVALID_LIMIT');if(!host)throw Error('HOST_REQUIRED');return this.using(host,async rpc=>{
  if(input.project)await this.verifyProject(rpc,host,this.projectPath(host,input.project))
  const page=await rpc.call('thread/list',{limit:Math.min(input.limit??25,100),...(input.project?{cwd:this.projectPath(host,input.project)}:{}),...(input.cursor?{cursor:input.cursor}:{}),sourceKinds:['cli','appServer','exec','vscode']})
  return {host,sessions:page.data.filter(t=>{try{this.projectPath(host,t.cwd);return true}catch{return false}}).map(t=>({thread_id:t.id,name:t.name,project:t.cwd,status:t.status?.type})),next_cursor:page.nextCursor}
 })}
 async attach(input){const host=input.host;if(typeof input.threadId!=='string'||!input.threadId)throw Error('THREAD_REQUIRED');return this.using(host,async rpc=>{
  const thread=(await rpc.call('thread/read',{threadId:input.threadId})).thread,cwd=this.projectPath(host,thread.cwd)
  await this.verifyProject(rpc,host,cwd)
  // Existing terminal sessions may be selected/read; stopping them requires a task explicitly submitted here.
  await this.store.update(s=>{s._routing??={};s._routing[this.scope]={host,cwd,thread_id:thread.id}});return {selected:{host,project:cwd,thread_id:thread.id},status:thread.status?.type}
 })}
 async start(...args){return start(this,...args)}
 async activate(){return this.store.locked('scope-'+this.scope,()=>this.store.update(s=>{if(s._cancelled)delete s._cancelled[this.scope];return {active:true}}))}
 async seal(){return this.store.locked('scope-'+this.scope,()=>this.store.update(s=>{s._cancelled??={};s._cancelled[this.scope]=new Date().toISOString();return {sealed:true}}))}
 async stopScope(...args){return stopScope(this,...args)}
 async submit(...args){return submit(this,...args)}
 async submitWithConfig(...args){return submitWithConfig(this,...args)}
 async reconcile(...args){return reconcile(this,...args)}
 async status(input){const target=await this.task(input.task);return this.usingTask(target,async rpc=>{
  const thread=(await rpc.call('thread/read',{threadId:target.thread_id})).thread
  const turn=target.turn_id?await this.turns(rpc,target):null
  const terminals=await this.terminals(rpc,target.thread_id);const latest=await rpc.call('thread/turns/list',{threadId:target.thread_id,limit:1,itemsView:'full',sortDirection:'desc'});if(latest.data[0]?.id===target.turn_id&&Array.isArray(target.terminal_baseline)){const owned=terminals.filter(t=>!target.terminal_baseline.includes(t.processId)).map(t=>t.processId);if(owned.length)await this.store.update(s=>{s[input.task].owned_terminal_ids=[...new Set([...(s[input.task].owned_terminal_ids??[]),...owned])]})}
  return {task:input.task,host:target.host,project:target.cwd,thread_id:target.thread_id,turn_id:target.turn_id,thread_status:thread.status?.type,turn_status:turn?.status??'unknown',submission:target.submission,background_commands:terminals.filter(t=>(target.owned_terminal_ids??[]).includes(t.processId)||Array.isArray(target.terminal_baseline)&&latest.data[0]?.id===target.turn_id&&!target.terminal_baseline.includes(t.processId)).map(t=>({process_id:t.processId,command:t.command})),commands:(turn?.items??[]).filter(i=>i.type==='commandExecution').map(i=>({id:i.id,command:i.command,status:i.status,exit_code:i.exitCode})),error:turn?.error??null,answer:(turn?.items??[]).filter(i=>i.type==='agentMessage').map(i=>({phase:i.phase,text:i.text?.slice(0,16000)}))}
 })}
 async stop(...args){return stop(this,...args)}
 async fetch(...args){return fetch(this,...args)}
 async run(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_INPUT');const actions={watch:()=>watchTask(this,input),seal:()=>this.seal(),'stop-scope':()=>this.stopScope(),activate:()=>this.activate(),reconcile:()=>this.reconcile(input),inspect:()=>this.inspect(input),select:()=>this.select(input),list:()=>this.list(input),attach:()=>this.attach(input),start:()=>this.start(input),send:()=>this.start(input),status:()=>this.status(input),result:()=>this.status(input),stop:()=>this.stop(input),fetch:()=>this.fetch(input)};if(!actions[input.action])throw Error('UNKNOWN_ACTION');if(['start','send'].includes(input.action))return actions[input.action]();return this.store.locked('host-config',()=>{this.assertCurrentHosts();return actions[input.action]()})}
}
