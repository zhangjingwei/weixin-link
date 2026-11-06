import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ScheduledDelivery} from './scheduled-delivery.mjs'
import {due,formatNews} from './news-job.mjs'
import {OutputTransport} from './outbound-media.mjs'
test('schedule uses Beijing time, start date and bounded catchup',()=>{const j={enabled:true,time:'08:00',startDate:'2026-10-20'};assert(!due(j,new Date('2026-10-19T00:00:00Z')));assert(due(j,new Date('2026-10-20T00:00:00Z')));assert(!due(j,new Date('2026-10-20T03:00:00Z')));assert(!due({...j,time:'25:00'},new Date()))})
test('duplicate concurrent runs send once; uncertain sends never automatically repeat; recipient comes only from allowed config',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scheduled-send-')),configPath=join(dir,'jobs.json');await writeFile(configPath,JSON.stringify({jobs:[{id:'news',enabled:true,recipient:'owner'},{id:'foreign',enabled:true,recipient:'other'},{id:'failed',enabled:true,recipient:'owner'}]}));let sends=[]
 const opts={dbPath:join(dir,'ledger.sqlite'),configPath,owners:['owner'],now:()=>new Date('2026-10-20T00:00:00Z'),send:async(u,t)=>{sends.push([u,t]);if(t==='bad')throw Error('uncertain');return {status:'accepted'}}};let d=new ScheduledDelivery(opts)
 try{const p={jobId:'news',occurrence:'2026-10-20',text:'hello',recipient:'attacker'};await Promise.all([d.deliver(p),d.deliver(p)]);assert.deepEqual(sends,[['owner','hello']]);await assert.rejects(d.deliver({...p,jobId:'foreign'}));await assert.rejects(d.deliver({...p,occurrence:'2026-10-19'}));assert.equal((await d.deliver({...p,jobId:'failed',text:'bad'})).state,'unknown');d.close();d=new ScheduledDelivery(opts);assert.equal((await d.deliver(p)).state,'accepted');assert.equal((await d.deliver({...p,jobId:'failed',text:'bad'})).state,'unknown');assert.equal(sends.length,2)}finally{d.close();await rm(dir,{recursive:true,force:true})}
})
test('news rendering separates excerpts from verified reporting and keeps source links',()=>{const s=formatNews({title:'早报'},[{title:'标题',excerpt:'摘录',link:'https://t.me/example/1'}],'2026-10-20');assert(s.includes('未经独立核实'));assert(s.includes('https://t.me/example/1'));assert(s.includes('摘录'))})
test('scheduled text records the actual transport acceptance, survives restart and never resends',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scheduled-transport-')),configPath=join(dir,'jobs.json')
 await writeFile(configPath,JSON.stringify({jobs:[{id:'article',enabled:true,recipient:'owner'}]}))
 const sent=[],transport=new OutputTransport({send:async(user,text)=>sent.push([user,text])})
 const opts={dbPath:join(dir,'ledger.sqlite'),configPath,owners:['owner'],now:()=>new Date('2026-10-20T04:45:00Z'),send:(user,text)=>transport.deliver(user,text)}
 let d=new ScheduledDelivery(opts)
 const request={jobId:'article',occurrence:'2026-10-20',text:'文章正文'}
 try{
  assert.deepEqual(await d.deliver(request),{state:'accepted',accepted:true})
  assert.equal((await d.status()).jobs[0].state,'accepted')
  d.close();d=new ScheduledDelivery(opts)
  assert.deepEqual(await d.deliver(request),{duplicate:true,state:'accepted'})
  assert.deepEqual(sent,[['owner','文章正文']])
 }finally{d.close();await rm(dir,{recursive:true,force:true})}
})
test('transport only accepts plain text after every part succeeds; cancellation and failures stay distinct',async()=>{
 const events=[],transport=new OutputTransport({send:async()=>{},log:(event,fields)=>events.push([event,fields])})
 assert.deepEqual(await transport.deliver('owner','段落。'.repeat(3000)),{status:'accepted'})
 assert(events.filter(([event])=>event==='outbound.text_accepted').length>1)
 assert.deepEqual(await transport.deliver('owner','不要发送',{current:()=>false}),{status:'cancelled'})
 let count=0
 const failure=new OutputTransport({send:async()=>{if(++count===2)throw Error('uncertain after first part')}})
 await assert.rejects(failure.deliver('owner','段落。'.repeat(3000)),/uncertain after first part/)
 assert.equal(count,2)
})
import {OutputStore} from './outbound-media.mjs'
test('scheduled third text failure still sends HTML, persists progress and never replays unknown parts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scheduled-progress-')),configPath=join(dir,'jobs.json'),file=join(dir,'news.html');await writeFile(file,'<!doctype html><p>news</p>');await writeFile(configPath,JSON.stringify({jobs:[{id:'digest',enabled:true,recipient:'owner'}]}));const store=new OutputStore({stateDir:join(dir,'state'),cwd:dir,roots:[dir]}),calls=[],logs=[]
 const transport=new OutputTransport({store,log:(e,d)=>logs.push([e,d]),send:async(_u,c)=>{calls.push(c);if(calls.length===3)throw Object.assign(Error('secret token must not appear'),{code:'ECONNRESET',status:502})}})
 const opts={dbPath:join(dir,'ledger.sqlite'),configPath,owners:['owner'],now:()=>new Date('2026-10-20T10:00:00Z'),prepare:(u,t)=>store.package(u,t),send:(u,p,o)=>transport.deliver(u,p,o)};let d=new ScheduledDelivery(opts)
 try{const request={jobId:'digest',occurrence:'2026-10-20',text:'正文。'.repeat(1300)+`\n[HTML](${file})`};assert.equal((await d.deliver(request)).state,'partial');assert(calls.some(c=>c.fileName==='news.html'));const row=d.db.prepare('SELECT packet FROM scheduled_delivery').get();const packet=JSON.parse(row.packet);assert.equal(packet.textParts[2],'unknown');assert.equal(packet.attachments[0].status,'accepted');assert.equal(packet.textErrors[2].http_status,502);assert(!JSON.stringify(logs).includes('secret token'));const count=calls.length;d.close();d=new ScheduledDelivery(opts);await d.resume({jobId:'digest',occurrence:'2026-10-20'});assert.equal(calls.length,count);assert.equal((await d.deliver(request)).duplicate,true)}finally{d.close();await rm(dir,{recursive:true,force:true})}
})
test('explicit recovery after interrupted dispatch sends only untouched text and attachment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scheduled-crash-')),configPath=join(dir,'jobs.json'),file=join(dir,'news.html');await writeFile(file,'<!doctype html>');await writeFile(configPath,JSON.stringify({jobs:[{id:'digest',enabled:true,recipient:'owner'}]}));const store=new OutputStore({stateDir:join(dir,'state'),cwd:dir,roots:[dir]}),calls=[];let fail=true
 const transport=new OutputTransport({store,send:async(_u,c)=>calls.push(c)})
 const opts={dbPath:join(dir,'ledger.sqlite'),configPath,owners:['owner'],now:()=>new Date('2026-10-20T10:00:00Z'),prepare:(u,t)=>store.package(u,t),send:async(u,p,o)=>{if(fail){fail=false;p.textParts[0]='accepted';calls.push('first');await o.checkpoint();throw Error('simulated interruption')}return transport.deliver(u,p,o)}};let d=new ScheduledDelivery(opts)
 try{await d.deliver({jobId:'digest',occurrence:'2026-10-20',text:'正文。'.repeat(700)+`\n[HTML](${file})`});d.close();d=new ScheduledDelivery(opts);assert.equal((await d.resume({jobId:'digest',occurrence:'2026-10-20'})).state,'accepted');assert.equal(calls.filter(x=>x==='first').length,1);assert.equal(calls.filter(x=>x.fileName==='news.html').length,1)}finally{d.close();await rm(dir,{recursive:true,force:true})}
})
