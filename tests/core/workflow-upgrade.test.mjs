import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {CancellationScopes} from '../../src/domain/tasks/lifecycle.mjs'
import {bindNewWorkspace} from '../../src/application/conversations/workspace.mjs'
import {conversationCommand} from '../../src/domain/conversations/commands.mjs'
import {SessionManager} from '../../src/base/codex/codex-session.mjs'
import {OutputStore,OutputTransport} from '../../src/infrastructure/media/outbound-media.mjs'
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'workflow-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}

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

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function queueFixture(t,rows,ask){
 const lifecycle=new CancellationScopes(),records=rows.map(([id,owner])=>({id,owner,input:id,state:'pending'}))
 const jobs={pending:()=>records.filter(j=>j.state==='pending'),mark:(id,state)=>{records.find(j=>j.id===id).state=state},cancel:owner=>{for(const j of records)if(j.owner===owner&&j.state==='pending')j.state='cancelled'}}
 const manager={cwd:'/shared/project',lifecycle,sessions:new Map(),state:{users:{}},ask,save:async()=>{}}
 const intake=new DurableIntake({jobs,manager,reply:async()=>{}})
 t.after(()=>{intake.close();lifecycle.close()})
 return {intake,lifecycle,records}
}

test('independent account queues can overlap in the same host workspace',{timeout:3000},async t=>{
 const enteredA=deferred(),enteredB=deferred(),release=deferred()
 t.after(()=>release.resolve())
 const a=queueFixture(t,[['a1','a']],async()=>{enteredA.resolve();await release.promise})
 const b=queueFixture(t,[['b1','b']],async()=>{enteredB.resolve();await release.promise})
 a.intake.wake('a');await enteredA.promise
 b.intake.wake('b');await enteredB.promise
 assert.equal(a.records[0].state,'pending');assert.equal(b.records[0].state,'pending')
 release.resolve();await Promise.all([...a.intake.users.values(),...b.intake.users.values()])
 assert.equal(a.records[0].state,'done');assert.equal(b.records[0].state,'done')
})

test('one conversation keeps ordinary tasks ordered even with repeated wake calls',{timeout:3000},async t=>{
 const entered=deferred(),release=deferred(),calls=[];t.after(()=>release.resolve())
 const {intake,records}=queueFixture(t,[['first','a'],['second','a']],async(owner,input)=>{
  calls.push(input.text);if(input.text==='first'){entered.resolve();await release.promise}
 })
 intake.wake('a');intake.wake('a');await entered.promise
 assert.deepEqual(calls,['first'])
 release.resolve();await intake.users.get('a')
 assert.deepEqual(calls,['first','second']);assert.ok(records.every(j=>j.state==='done'))
})

test('cancelling one conversation leaves another running and cancels only its own queue',{timeout:3000},async t=>{
 const enteredA=deferred(),enteredB=deferred(),releaseB=deferred(),calls=[];let tokenB
 t.after(()=>releaseB.resolve())
 const {intake,lifecycle,records}=queueFixture(t,[['a1','a'],['a2','a'],['b1','b']],async(owner,input,reply,timeout,token)=>{
  calls.push(input.text)
  if(owner==='a'){enteredA.resolve();await new Promise(resolve=>token.signal.addEventListener('abort',resolve,{once:true}))}
  else{tokenB=token;enteredB.resolve();await releaseB.promise}
 })
 intake.wake('a');intake.wake('b');await Promise.all([enteredA.promise,enteredB.promise])
 intake.cancel('a');lifecycle.cancel('a');await intake.users.get('a')
 assert.equal(tokenB.current(),true);assert.deepEqual(calls,['a1','b1'])
 assert.equal(records[0].state,'cancelled');assert.equal(records[1].state,'cancelled');assert.equal(records[2].state,'pending')
 releaseB.resolve();await intake.users.get('b');assert.equal(records[2].state,'done')
})
