import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {ExecutionGate} from '../../src/core/runtime/execution-gate.mjs'
import {DurableIntake} from '../../src/core/durable-intake.mjs'
import {CancellationScopes} from '../../src/core/tasks/lifecycle.mjs'
import {bindNewWorkspace} from '../../src/core/conversations/workspace.mjs'
import {conversationCommand} from '../../src/core/conversations/commands.mjs'
import {SessionManager} from '../../src/base/codex/codex-session.mjs'
import {OutputStore,OutputTransport} from '../../src/media/outbound-media.mjs'
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'workflow-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}

test('reservation survives process exit and another account cannot steal or release it',async t=>{
 const dir=await fixture(t),module=new URL('../../src/core/runtime/execution-gate.mjs',import.meta.url).href
 const child=spawn(process.execPath,['--input-type=module','-e',`import {ExecutionGate} from ${JSON.stringify(module)};await new ExecutionGate(process.argv[1]).claim({account:'a',job:'1'})`,dir],{stdio:'ignore'})
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('child failed')))})
 const gate=new ExecutionGate(dir)
 assert.equal(await gate.claim({account:'b',job:'2'}),false)
 await gate.release({account:'b',job:'2'})
 assert.equal(await gate.claim({account:'a',job:'1'},{recovery:true}),true)
 await gate.release({account:'a',job:'1'})
 assert.equal(await gate.claim({account:'b',job:'2'}),true)
 await gate.release({account:'b',job:'2'})
})

test('separate account queues serialize on the machine gate and cancelled waiters never start',async t=>{
 const dir=await fixture(t);let active=0,peak=0,calls=0
 const make=(name,wait)=>{
  const pending=[{id:name,owner:name,state:'pending',input:'fixture'}],lifecycle=new CancellationScopes()
  const manager={stateDir:name,executionGate:new ExecutionGate(dir),state:{users:{}},sessions:new Map(),lifecycle,ask:async()=>{calls++;active++;peak=Math.max(peak,active);await wait();active--;return {status:'completed'}},save:async()=>{}}
  const jobs={pending:()=>pending,mark:()=>pending.splice(0),get:()=>pending[0]}
  return {queue:new DurableIntake({jobs,manager,reply:async()=>{}}),lifecycle}
 }
 let release;const hold=new Promise(r=>{release=r}),a=make('a',()=>hold),b=make('b',async()=>{})
 const first=a.queue.pump('a')
 while(!calls)await new Promise(r=>setTimeout(r,5))
 const second=b.queue.pump('b');await new Promise(r=>setTimeout(r,30));b.lifecycle.cancel('b');await second
 assert.equal(calls,1);release();await first
 await b.queue.pump('b');assert.equal(calls,2);assert.equal(peak,1)
})

test('workspace binding validates existing paths, is immutable after connection and survives restart',async t=>{
 const dir=await fixture(t),project=join(dir,'project');await mkdir(project)
 const manager=await new SessionManager({stateDir:join(dir,'state'),cwd:dir,owners:['a'],remoteControl:async()=>({})}).init()
 t.after(()=>manager.close())
 assert.equal(conversationCommand(`新建项目 demo | ${project}`).workspace,project)
 assert.equal(conversationCommand('当前目录').action,'workspace')
 await assert.rejects(bindNewWorkspace({manager},'a','relative'))
 await bindNewWorkspace({manager},'a',project)
 assert.equal(manager.workspaceFor('a'),await realpath(project))
 const reloaded=await new SessionManager({stateDir:join(dir,'state'),cwd:dir,owners:['a']}).init();t.after(()=>reloaded.close())
 assert.equal(reloaded.workspaceFor('a'),await realpath(project))
 manager.state.users.a.threadId='existing'
 await assert.rejects(bindNewWorkspace({manager},'a',dir),/已有会话/)
 assert.equal(manager.workspaceFor('b'),dir)
})

test('missing and mixed artifacts remain partial even if their explanation was delivered',async t=>{
 const dir=await fixture(t),store=new OutputStore({cwd:dir,stateDir:join(dir,'state')})
 await writeFile(join(dir,'ok.txt'),'fixture')
 for(const text of [`[missing](${join(dir,'missing.pdf')})`,`[ok](${join(dir,'ok.txt')}) [missing](${join(dir,'missing.pdf')})`]){
  const packet=await store.package('owner',text)
  const output=new OutputTransport({store,send:async()=>({message_id:'fake'})})
  assert.equal((await output.deliver('owner',packet)).status,'partial')
  assert.equal(packet.errors[0].code,'FILE_NOT_FOUND')
 }
})

test('unknown execution retains reservation for reconciliation instead of opening the next account',async t=>{
 const dir=await fixture(t),gate=new ExecutionGate(dir),job={id:'job',owner:'owner',state:'pending',input:'fixture'}
 const jobs={pending:()=>['pending','bound'].includes(job.state)?[job]:[],get:()=>job,mark:(_,state)=>{job.state=state}}
 const manager={stateDir:'account',executionGate:gate,state:{users:{}},sessions:new Map(),lifecycle:new CancellationScopes(),save:async()=>{},ask:async()=>{job.state='bound';return {status:'unknown'}}}
 const queue=new DurableIntake({jobs,manager,reply:async()=>{}})
 await queue.pump('owner');assert.equal(job.state,'uncertain')
 assert.equal(await new ExecutionGate(dir).claim({account:'other',job:'2'}),false)
 job.state='bound';queue.recover=async()=>{job.state='done'}
 await queue.pump('owner');assert.equal(await gate.read(),null)
})

test('bound workspace reaches RPC start and output packaging, not just navigation metadata',async t=>{
 const dir=await fixture(t),project=join(dir,'project'),calls=[];await mkdir(project)
 const manager=await new SessionManager({cwd:dir,stateDir:join(dir,'state'),owners:['a'],rpcFactory:options=>{
  calls.push({method:'spawn',cwd:options.cwd})
  return {closed:false,write(){},close(){this.closed=true},async request(method,params){calls.push({method,...params});if(method==='thread/start')return {thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'};return {}}}
 }}).init();t.after(()=>manager.close())
 await bindNewWorkspace({manager},'a',project);await manager.connect('a',async()=>{})
 assert.equal(calls.find(c=>c.method==='spawn').cwd,await realpath(project))
 assert.equal(calls.find(c=>c.method==='thread/start').cwd,await realpath(project))
 assert.equal(manager.outputStoreFor('a').cwd,await realpath(project))
})

test('final reply retains artifact preparation error through display reconstruction',async t=>{
 const dir=await fixture(t),manager=await new SessionManager({stateDir:join(dir,'state'),cwd:dir,owners:['a']}).init(),output=[]
 t.after(()=>manager.close());manager.state.users.a={}
 const session={userId:'a',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async value=>output.push(value)}
 await manager.event(session,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'final',type:'agentMessage',phase:'final_answer',text:`[report](${join(dir,'absent.pdf')})`}}})
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 const bundle=output.find(value=>value?.kind==='bundle')
 assert.match(bundle.text,/FILE_NOT_FOUND/)
 assert.equal(bundle.attachments.length,0)
})

test('startup clears an unsubmitted reservation but retains a bound uncertain job',async t=>{
 const dir=await fixture(t),gate=new ExecutionGate(dir),identity={account:'account',job:'job'},job={state:'pending',thread_id:null}
 const manager={stateDir:'account',executionGate:gate,owners:new Set()}
 const queue=new DurableIntake({manager,jobs:{get:()=>job,pending:()=>[]}})
 await gate.claim(identity);await queue.resumeQueues();assert.equal(await gate.read(),null)
 await gate.claim(identity);job.state='uncertain';job.thread_id='thread'
 await queue.resumeQueues();assert.deepEqual(await gate.read(),identity)
})
