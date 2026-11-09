import './remote-test-config.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {RemoteController,projectPath,exportPath} from '../../src/application/remote-tasks/remote-controller.mjs'
import {RemoteStore} from '../../src/infrastructure/storage/registry-lock.mjs'
const cwd='/home/example/work/test'
async function setup(handler,{symlinkPath}={}){const root=await mkdtemp('/tmp/remote-controller-test-'),calls=[];const c=new RemoteController({root,scope:'test',rpcFactory:()=>({async connect(){},close(){},async call(m,p){calls.push([m,p]);if(m==='fs/getMetadata'&&['/home/example/work',cwd].includes(p.path))return {isDirectory:true,isSymlink:p.path===symlinkPath};return handler(m,p)}})});return {root,c,calls}}
async function own(c,extra={}){await c.store.update(s=>{s.t={kind:'official-remote-task',scope:c.scope,host:'spark',cwd,thread_id:'thread',turn_id:'old',...extra}})}
test('project and export paths cannot escape authorized roots',()=>{for(const p of ['/etc','/home/example/work/../x','/home/example/work/.secret'])assert.throws(()=>projectPath('spark',p));assert.equal(projectPath('spark',cwd),cwd);for(const p of ['/etc/passwd',cwd+'/.env',cwd+'/private_key.pem'])assert.throws(()=>exportPath(cwd,p))})
test('one action keeps its validated host snapshot and refuses a changed config before RPC',async()=>{
 const root=await mkdtemp('/tmp/remote-snapshot-'),configPath=join(root,'remote-hosts.json')
 const original={platform:'posix',binary:'/opt/codex',root:'/home/example/work',transport:'daemon-proxy'}
 await writeFile(configPath,JSON.stringify({version:1,hosts:{spark:original}}))
 let connected=false,seen
 const c=new RemoteController({root,configPath,scope:'snapshot',rpcFactory:(_host,config)=>{seen=config;return {async connect(){connected=true},close(){}}}})
 assert.equal(c.projectPath('spark',cwd),cwd)
 await c.using('spark',async()=>{})
 assert.equal(seen.root,original.root)
 assert.equal(Object.isFrozen(seen),true)
 await writeFile(configPath,JSON.stringify({version:1,hosts:{spark:{...original,root:'/other'}}}))
 assert.equal(c.projectPath('spark',cwd),cwd)
 await assert.rejects(c.run({action:'inspect',host:'spark',project:cwd}),/REMOTE_HOST_CONFIG_CHANGED/)
 connected=false
 await assert.rejects(c.run({action:'start',host:'spark',project:cwd,prompt:'hello'}),/REMOTE_HOST_CONFIG_CHANGED/)
 assert.equal(connected,false)
})
test('concurrent registry updates preserve every entry and legacy state',async()=>{const {root}=await setup(()=>{}),store=new RemoteStore(root);await store.update(s=>{s.legacy={id:1}});await Promise.all(Array.from({length:12},(_,i)=>store.update(s=>{s[i]=i})));const s=await store.read();assert.equal(Object.keys(s).length,13);assert.deepEqual(s.legacy,{id:1})})
test('lock is released when operation fails',async()=>{const {c}=await setup(()=>{});await assert.rejects(c.store.locked('test',()=>{throw Error('expected')}));assert.equal(await c.store.locked('test',()=>42),42)})
test('another conversation cannot query or cancel a task',async()=>{const {c,calls}=await setup(()=>{});await own(c,{scope:'someone-else'});await assert.rejects(c.stop({task:'t'}),/TASK_NOT/);assert.equal(calls.length,0)})
test('old turn stop preserves newer turn and its terminals across pages',async()=>{let terminated=[];const {c,calls}=await setup((m,p)=>{if(m==='thread/resume')return {};if(m==='thread/turns/list')return {data:[{id:'old',status:'interrupted',items:[{id:'cmd-old',type:'commandExecution'}]}]};if(m==='thread/backgroundTerminals/list')return p.cursor?{data:terminated.length?[]:[{itemId:'cmd-old',processId:'old-process'}]}:{data:[{itemId:'cmd-new',processId:'new-process'}],nextCursor:'page2'};if(m==='thread/backgroundTerminals/terminate'){terminated.push(p.processId);return {terminated:true}}throw Error(m)});await own(c);const result=await c.stop({task:'t'});assert.equal(result.stop_confirmed,true);assert.deepEqual(terminated,['old-process']);assert.equal(calls.filter(([m])=>m==='turn/interrupt').length,0)})
test('busy project on later page prevents submission',async()=>{const {c,calls}=await setup((m,p)=>{assert.equal(m,'thread/list');return p.cursor?{data:[{status:{type:'active'}}]}:{data:[],nextCursor:'page2'}});await assert.rejects(c.start({host:'spark',project:cwd,prompt:'hi'}),/PROJECT_BUSY/);assert.equal(calls.filter(([m])=>m==='thread/list').length,2)})
test('remote project symlink is refused before starting a thread',async()=>{const {c,calls}=await setup(()=>{throw Error('must not start')},{symlinkPath:cwd});await assert.rejects(c.start({host:'spark',project:cwd,prompt:'hi'}),/PROJECT_SYMLINK_REFUSED/);assert.equal(calls.some(([m])=>m==='thread/start'),false)})
test('remote project inspection does not read instruction files above the authorized root',async()=>{const {c,calls}=await setup((m)=>{if(m==='fs/readFile')throw Error('REMOTE_RPC_ERROR');if(m==='fs/getMetadata')return {isDirectory:false};throw Error(m)});await c.inspect({host:'spark',project:cwd});const reads=calls.filter(([m])=>m==='fs/readFile').map(([,p])=>p.path);assert.ok(reads.length>0);assert.ok(reads.every(path=>path.startsWith('/home/example/work/')))})
test('uncertain mutation is recorded and never automatically retried',async()=>{const {c,calls}=await setup(m=>{if(m==='thread/list')return {data:[]};if(m==='thread/start')return {thread:{id:'new'}};if(m==='thread/backgroundTerminals/list')return {data:[]};if(m==='turn/start')throw Error('REMOTE_DISCONNECTED');throw Error(m)});let task;try{await c.start({host:'spark',project:cwd,prompt:'hello'})}catch(e){assert.equal(e.message,'SUBMISSION_UNCERTAIN_DO_NOT_RESUBMIT');task=e.task}assert.ok(task);assert.equal((await c.task(task)).submission,'unknown');assert.equal(calls.filter(([m])=>m==='turn/start').length,1)})
test('reconcile identifies only matching official client message ID',async()=>{const {c}=await setup(()=>({data:[{id:'matching-turn',items:[{type:'userMessage',clientId:'operation'}]}]}));await own(c,{turn_id:null,operation_id:'operation',submission:'unknown'});assert.equal((await c.reconcile({task:'t'})).turn_id,'matching-turn');assert.equal((await c.task('t')).submission,'confirmed')})
test('artifact symlink is rejected before reading contents',async()=>{const {c,calls}=await setup((m,p)=>{assert.equal(m,'fs/getMetadata');return {isSymlink:p.path.endsWith('result.txt')}});await own(c);await assert.rejects(c.fetch({task:'t',path:cwd+'/result.txt'}),/SYMLINK/);assert.equal(calls.some(([m])=>m==='fs/readFile'),false)})
test('live terminal absent from history is stopped using per-turn baseline',async()=>{let ended=false;const {c}=await setup((m,p)=>{if(m==='thread/resume')return {};if(m==='thread/turns/list')return {data:[{id:'old',status:ended?'interrupted':'inProgress',items:[]}]};if(m==='turn/interrupt'){ended=true;return {}}if(m==='thread/backgroundTerminals/list')return {data:ended===true?[]:[{processId:'live',itemId:'not-in-history'}]};throw Error(m)});await own(c,{terminal_baseline:[]});const stop=await c.stop({task:'t'});assert.equal(stop.stop_confirmed,true);assert.deepEqual((await c.task('t')).owned_terminal_ids,['live'])})
test('unattributed command in a newer turn prevents false stop confirmation',async()=>{const {c}=await setup(m=>{if(m==='thread/resume')return {};if(m==='thread/turns/list')return {data:[{id:'new',status:'inProgress',items:[]},{id:'old',status:'interrupted',items:[]}]};if(m==='thread/backgroundTerminals/list')return {data:[{processId:'unknown',itemId:'unattributed'}]};throw Error(m)});await own(c,{terminal_baseline:[]});await assert.rejects(c.stop({task:'t'}),/OWNERSHIP_UNCONFIRMED/)})
test('scope stop seals future submissions, isolates scopes and is repeatable',async()=>{const {c,calls}=await setup(()=>{throw Error('must not connect')});await c.store.update(s=>{s.foreign={kind:'official-remote-task',scope:'another',host:'spark',cwd}});assert.deepEqual(await c.stopScope(),{stop_confirmed:true,tasks:[]});await assert.rejects(c.start({host:'spark',project:cwd,prompt:'late queued task'}),/SCOPE_STOPPED/);assert.equal(calls.length,0);assert.equal((await c.stopScope()).stop_confirmed,true);await c.activate();assert.equal((await c.store.read())._cancelled[c.scope],undefined)})
test('unknown submission cannot produce a successful full-stop result',async()=>{const {c}=await setup(()=>({data:[]}));await own(c,{turn_id:null,operation_id:'lost',submission:'unknown'});const r=await c.stopScope();assert.equal(r.stop_confirmed,false);assert.equal(r.tasks[0].error,'SUBMISSION_UNKNOWN_REQUIRE_RECONCILIATION')})
test('command registered during interruption is included in cleanup',async()=>{let interrupted=false,terminated=false;const {c}=await setup((m,p)=>{if(m==='thread/resume')return {};if(m==='thread/turns/list')return {data:[{id:'old',status:interrupted?'interrupted':'inProgress',items:[]}]};if(m==='turn/interrupt'){interrupted=true;return {}}if(m==='thread/backgroundTerminals/list')return {data:interrupted&&!terminated?[{itemId:'late',processId:'late-process'}]:[]};if(m==='thread/backgroundTerminals/terminate'){assert.equal(p.processId,'late-process');terminated=true;return {terminated:true}}throw Error(m)});await own(c,{terminal_baseline:[]});assert.equal((await c.stop({task:'t'})).commands_terminated,1);assert.equal(terminated,true)})

test('Windows paths use drive-aware containment and reject traversal and hidden exports',()=>{
 assert.equal(projectPath('windows197','C:\\Users\\example\\work\\demo'),'C:\\Users\\example\\work\\demo');
 assert.throws(()=>projectPath('windows197','C:\\Users\\other\\demo'));
 assert.throws(()=>projectPath('windows197','C:\\Users\\example\\..\\other'));
 assert.throws(()=>projectPath('windows197','C:\\Users\\example\\.ssh'));
 assert.throws(()=>projectPath('windows197','D:\\demo'));
 assert.equal(exportPath('C:\\Users\\example\\work','C:\\Users\\example\\work\\out.txt'),'C:\\Users\\example\\work\\out.txt');
 assert.throws(()=>exportPath('C:\\Users\\example\\work','C:\\Users\\example\\work2\\out.txt'));
 assert.throws(()=>exportPath('C:\\Users\\example\\work','C:\\Users\\example\\work\\.secret\\out.txt'));
})
