import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {CancellationScopes} from '../../src/infrastructure/runtime/cancellation-scopes.mjs'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'
const wait=()=>new Promise(r=>setTimeout(r,30))
test('two-step command choice survives inbox restart',async()=>{const d=await mkdtemp('/tmp/command-inbox-'),path=join(d,'q.sqlite');let jobs=new DurableJobs(path);try{jobs.capture({userId:'a',text:'2',_conversationCommand:null,_sessionCommand:{action:'resume',selection:'2'},raw:{message_id:'choice-1'}});jobs.close();jobs=new DurableJobs(path);const message=jobs.rawPending()[0];assert.equal(message._conversationCommand,null);assert.deepEqual(message._sessionCommand,{action:'resume',selection:'2'})}finally{jobs.close();await rm(d,{recursive:true,force:true})}})
test('inbox survives reopening, deduplicates by owner, and preserves submitted work after stop',async()=>{const d=await mkdtemp('/tmp/inbox-'),path=join(d,'jobs.sqlite');let q=new DurableJobs(path);try{const id=q.add('a','first','sdk');assert.equal(q.add('a','duplicate','sdk'),id);assert.notEqual(q.add('b','other','sdk'),id);q.bind(id,'thread');q.submitted(id,'turn');q.close();q=new DurableJobs(path);assert.equal(q.get(id).turn_id,'turn');q.cancel('a');q.close();q=new DurableJobs(path);assert.equal(q.get(id).state,'submitted');assert.equal(q.pending().length,2);assert.equal(q.add('a','redelivery','sdk'),id);assert.equal(q.get(id).state,'submitted')}finally{q.close();await rm(d,{recursive:true,force:true})}})
test('pending intake processes in order without replaying uncertain work',async()=>{const d=await mkdtemp('/tmp/intake-'),jobs=new DurableJobs(join(d,'q.sqlite')),seen=[],lifecycle=new CancellationScopes(),manager={owners:new Set(['a']),lifecycle,cwd:d,ask:async(owner,input)=>{seen.push(input.text);jobs.bind(input.deliveryId,'t');jobs.submitted(input.deliveryId,'turn')}};const intake=new DurableIntake({jobs,manager,reply:async()=>{}});try{intake.submit('a','one','1');intake.submit('a','two','2');await wait();await wait();assert.deepEqual(seen,['one','two']);assert.equal(jobs.pending().length,0)}finally{intake.close();jobs.close();await rm(d,{recursive:true,force:true})}})
test('unknown bound submission is retained, never resubmitted',async()=>{const d=await mkdtemp('/tmp/recovery-'),jobs=new DurableJobs(join(d,'q.sqlite')),id=jobs.add('a','do not duplicate','id');jobs.bind(id,'thread');let submitted=0;const manager={owners:new Set(['a']),lifecycle:new CancellationScopes(),cwd:d,protocol:createSessionProtocol({kind:'codex'}),connect:async()=>({threadId:'thread',rpc:{request:async()=>({data:[]})}}),ask:async()=>submitted++};const intake=new DurableIntake({jobs,manager,reply:async()=>{}});try{intake.resume();await wait();assert.equal(jobs.get(id).state,'uncertain');assert.equal(submitted,0)}finally{intake.close();jobs.close();await rm(d,{recursive:true,force:true})}})
test('completed official turn is recovered into result without rerunning or blindly resending',async()=>{const d=await mkdtemp('/tmp/result-recovery-'),jobs=new DurableJobs(join(d,'q.sqlite')),id=jobs.add('a','question','id');jobs.bind(id,'thread');jobs.submitted(id,'turn');const state={users:{a:{}}},manager={state,save:async()=>{},owners:new Set(['a']),lifecycle:new CancellationScopes(),protocol:createSessionProtocol({kind:'codex'}),connect:async()=>({threadId:'thread',rpc:{request:async()=>({data:[{id:'turn',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'saved answer'}]}]})}})};const replies=[],intake=new DurableIntake({jobs,manager,reply:async(o,t)=>replies.push(t)});try{intake.resume();await wait();assert.equal(jobs.get(id).state,'done');assert.equal(state.users.a.lastReply,'saved answer');assert.ok(!replies.includes('saved answer'))}finally{intake.close();jobs.close();await rm(d,{recursive:true,force:true})}})
test('raw media envelope survives restart and stop cancels raw intake too',async()=>{const d=await mkdtemp('/tmp/raw-inbox-'),path=join(d,'q.sqlite');let jobs=new DurableJobs(path);try{const message={userId:'a',text:'看图',images:[{url:'https://example.invalid/image'}],raw:{message_id:'raw-1'}},id=jobs.capture(message);jobs.close();jobs=new DurableJobs(path);assert.equal(jobs.rawPending()[0]._ingressId,id);assert.equal(jobs.rawPending()[0].images.length,1);jobs.cancel('a');assert.equal(jobs.rawCurrent(id),false);assert.equal(jobs.capture(message),null);assert.equal(jobs.rawPending().length,0)}finally{jobs.close();await rm(d,{recursive:true,force:true})}})
test('WAL inbox survives an abrupt process kill after acknowledged writes',async()=>{const {spawn}=await import('node:child_process'),d=await mkdtemp('/tmp/crash-inbox-'),path=join(d,'q.sqlite'),modulePath=new URL('../../src/infrastructure/storage/durable-jobs.mjs',import.meta.url).href;let child;try{child=spawn(process.execPath,['--input-type=module','-e',`import {DurableJobs} from ${JSON.stringify(modulePath)};const q=new DurableJobs(process.argv[1]);const id=q.add('owner','persisted','sdk-id');q.bind(id,'official-thread');process.stdout.write(id+'\\n');setInterval(()=>{},1000)`,path],{stdio:['ignore','pipe','ignore']});const id=await new Promise((resolve,reject)=>{let data='';child.on('error',reject);child.stdout.on('data',c=>{data+=c;if(data.includes('\n'))resolve(data.trim())})});const closed=new Promise(r=>child.once('close',r));child.kill('SIGKILL');await closed;const jobs=new DurableJobs(path);try{assert.equal(jobs.get(id).state,'bound');assert.equal(jobs.get(id).thread_id,'official-thread')}finally{jobs.close()}}finally{child?.kill();await rm(d,{recursive:true,force:true})}})
test('text waiting in the shared outbound queue is suppressed after stop',async()=>{const {OutputTransport}=await import('../../src/infrastructure/media/outbound-media.mjs');let release,current=true;const gate=new Promise(r=>{release=r}),sent=[],transport=new OutputTransport({send:async(owner,value)=>{sent.push(value);if(value==='first')await gate}});const first=transport.deliver('owner','first'),second=transport.deliver('owner','cancelled',{current:()=>current});await wait();current=false;release();await first;assert.equal((await second).status,'cancelled');assert.deepEqual(sent,['first'])})
test('prepared media insertion and raw batch acknowledgement commit atomically',async()=>{const d=await mkdtemp('/tmp/batch-atomic-'),jobs=new DurableJobs(join(d,'q.sqlite'));try{const a=jobs.capture({userId:'a',text:'image',raw:{message_id:'1'}}),b=jobs.capture({userId:'a',text:'task',raw:{message_id:'2'}});const id=jobs.add('a',{text:'prepared',images:[]},a+':'+b,[a,b]);assert.equal(jobs.rawPending().length,0);assert.equal(jobs.get(id).state,'pending');assert.equal(jobs.add('a',{text:'prepared'},a+':'+b,[a,b]),id);assert.equal(jobs.pending().length,1)}finally{jobs.close();await rm(d,{recursive:true,force:true})}})
test('stop while Codex is connecting cannot start a cancelled durable message',async()=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs'),d=await mkdtemp('/tmp/stop-connect-');let release,started=0,ready;const connected=new Promise(r=>ready=r)
 const manager=await new SessionManager({stateDir:d,cwd:d,owners:['owner'],remoteControl:async()=>({stop_confirmed:true,tasks:[]}),rpcFactory:()=>({closed:false,async request(method){if(method==='thread/start')return new Promise(r=>{release=r;ready()});if(method==='turn/start'){started++;return {turn:{id:'forbidden'}}}return {}},write(){},close(){this.closed=true}})}).init(),jobs=new DurableJobs(join(d,'q.sqlite')),intake=new DurableIntake({jobs,manager,reply:async()=>{}});manager.submissions=jobs;manager.lifecycle.onCancel(owner=>intake.cancel(owner))
 try{const id=intake.submit('owner','must be cancelled','sdk');await connected;await manager.handle('owner','停止',async()=>{});release({thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'});await wait();assert.equal(started,0);assert.equal(jobs.get(id).state,'cancelled')}finally{intake.close();for(const s of manager.sessions.values())manager.resolveWaiters(s,{status:'interrupted'});manager.close();await manager.saving;jobs.close();await rm(d,{recursive:true,force:true})}
})
test('unknown execution can still be reconciled after a later stop', async t => {
 const dir=await mkdtemp(join(tmpdir(),'uncertain-stop-'))
 const jobs=new DurableJobs(join(dir,'jobs.sqlite'))
 t.after(async()=>{jobs.close();await rm(dir,{recursive:true,force:true})})
 const id=jobs.add('owner','work')
 const manager={lifecycle:new CancellationScopes(),state:{users:{owner:{}}},ask:async()=>{
  jobs.bind(id,'thread')
  jobs.submitted(id,'turn')
  return {status:'unknown'}
 }}
 const intake=new DurableIntake({jobs,manager,reply:async()=>{}})
 await intake.pump('owner')
 const queued=jobs.add('owner','next')
 intake.cancel('owner')
 assert.equal(jobs.get(queued).state,'cancelled')
 assert.equal(jobs.get(id).state,'uncertain')
 assert.equal(jobs.recheck('owner'),1)
 assert.equal(jobs.get(id).turn_id,'turn')
})

test('writer conflict before submission ends the job and reports the specific cause',async t=>{
 const dir=await mkdtemp('/tmp/writer-busy-'),jobs=new DurableJobs(join(dir,'jobs.db'))
 t.after(async()=>{jobs.close();await rm(dir,{recursive:true,force:true})})
 const id=jobs.add('owner',{text:'test'},'message'),notices=[]
 const manager={lifecycle:new CancellationScopes(),ask:async()=>{throw Object.assign(Error('busy'),{code:'CODEX_THREAD_WRITER_BUSY'})}}
 const intake=new DurableIntake({manager,jobs,reply:async(_,text)=>notices.push(text)})
 await intake.pump('owner')
 assert.equal(jobs.get(id).state,'cancelled')
 assert.match(notices[0],/本条消息尚未提交/)
 assert.equal(jobs.pending().length,0)
})

test('desktop confirmation stays bound to the blocked thread and only one original job runs after release',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'desktop-confirm-')),jobs=new DurableJobs(join(dir,'jobs.db'))
 const id=jobs.add('a',{text:'original'},'message'),sent=[],attempts=[]
 let blocked=true
 const manager={state:{users:{a:{threadId:'thread'}}},lifecycle:new CancellationScopes(),ask:async(_,input)=>{
  if(blocked)throw Object.assign(Error('busy'),{code:'CODEX_THREAD_WRITER_BUSY',threadId:'thread'})
  attempts.push(input);return {status:'completed'}
 }}
 const intake=new DurableIntake({jobs,manager,reply:async(_,value)=>sent.push(value)})
 t.after(async()=>{intake.close();jobs.close();await rm(dir,{recursive:true,force:true})})
 await intake.pump('a')
 assert.equal(jobs.get(id).state,'waiting_desktop')
 let {code}=jobs.get(id).context.desktopConfirmation
 assert.match(sent[0],/关闭后回复“继续”/)
 assert.deepEqual(jobs.desktopChoices('a','thread'),[code])
 assert.deepEqual(jobs.desktopChoices('other','thread'),[])
 const confirm=userId=>intake.confirmDesktop({userId},'继续',code,value=>sent.push(value))
 await confirm('other');await confirm('a');await intake.users.get('a')
 code=jobs.get(id).context.desktopConfirmation.code
 assert.equal(jobs.get(id).state,'waiting_desktop')
 assert.equal(attempts.length,0)
 blocked=false
 await confirm('a');await intake.users.get('a');await confirm('a')
 assert.equal(jobs.get(id).state,'done')
 assert.deepEqual(attempts.map(a=>[a.text,a.expectedThreadId,a.deliveryId]),[['original','thread',id]])
})

test('explicit desktop quit checks the bound thread, then resumes just its waiting message',async()=>{
 const manager={state:{users:{key:{threadId:'original'}}}}
 const target={app:'Codex'},thread={id:'original'},calls=[],output=[]
 const conversations={entry:()=>({owner:'peer'}),withBackend:(_,fn)=>fn({}),backendPort:{readConversation:async()=>thread}}
 const jobs={desktopChoices:()=>['code'],desktopJob:()=>({id:'job'}),retryAfterDesktop:()=>true}
 const desktopWriter={inspect:async t=>{assert.equal(t,thread);return target},release:async(t,app,current)=>{assert.equal(app,target);assert.ok(current());calls.push('quit')}}
 const intake=new DurableIntake({manager,jobs,conversations,desktopWriter})
 intake.wake=key=>calls.push(key)
 const quit=id=>intake.quitDesktop({userId:'key',_desktopQuit:{threadId:id}},s=>output.push(s))
 await quit('old')
 assert.deepEqual(calls,[])
 await quit('original')
 assert.deepEqual(calls,['quit','key'])
 desktopWriter.release=async()=>{throw Error('still active')}
 await quit('original')
 assert.deepEqual(calls,['quit','key'])
 assert.match(output.at(-1),/未能确认/)
})

test('a busy durable turn hands its next text to the native queue once and delivers the matching native result',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-queue-')),jobs=new DurableJobs(join(dir,'jobs.db'))
 const owner='person',first=jobs.add(owner,'first','first')
 jobs.bind(first,'thread');jobs.submitted(first,'active')
 const session={userId:owner,threadId:'thread',taskId:first,busy:true,turnReady:true,rpc:{}},enqueued=[],sent=[]
 const manager={sessions:new Map([[owner,session]]),state:{users:{[owner]:{threadId:'thread'}}},lifecycle:new CancellationScopes(),ports:{flowInput:()=>({type:'text',text:'metadata'}),materialInput:()=>({type:'text',text:'materials'})},protocol:{
  input:value=>[{type:'text',text:value.text}],enqueue:async(_rpc,tid,id,input)=>enqueued.push({tid,id,input}),
  findQueued:async()=>null,recoverTurn:async()=>({id:'next',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'answer'}]}),cleanOutputText:x=>x
 },save:async()=>{},connect:async()=>session,outputStoreFor:()=>({package:async(_,text)=>text})}
 const intake=new DurableIntake({jobs,manager,reply:async(_,value)=>{sent.push(value);return {status:'accepted'}}})
 t.after(async()=>{intake.close();jobs.close();await rm(dir,{recursive:true,force:true})})
 intake.users.set(owner,Promise.resolve())
 const id=intake.submit(owner,{text:'second'},'second')
 intake.submit(owner,{text:'second'},'second')
 assert.equal(enqueued.length,1);assert.equal(enqueued[0].id,id)
 assert.equal(jobs.get(id).state,'bound')
 jobs.mark(first,'done');session.busy=false
 await intake.pump(owner)
 assert.equal(jobs.get(id).state,'done');assert.deepEqual(sent,['answer'])
})
