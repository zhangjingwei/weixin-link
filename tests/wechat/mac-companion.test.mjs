import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {CompanionAccess} from '../../src/infrastructure/storage/companion-access.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {macCompanion} from '../../src/application/conversations/mac-companion.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {createWeChatController} from '../../src/interfaces/controllers/wechat-controller.mjs'
import {prepareMedia,hasMedia} from '../../src/infrastructure/media/media-input.mjs'
import {controlRequest,RuntimeControl} from '../../src/infrastructure/runtime/runtime-control.mjs'

test('Mac sidebar reads only the selected owned conversation; browsing cannot retarget a write',async()=>{
 const catalog={active:'1',entries:[{id:'1',key:'alpha',name:'同名'},{id:'2',key:'beta',name:'同名'},{id:'3',archived:true},{id:'4',deleted:true}]}
 const state={writer:'mac',revision:3},record=key=>({threadId:key,nativeProjectId:'shared-project',workspace:'/demo/Shared',lastReply:key+' result',resultIdentity:{threadId:key,createdAt:'2026-01-05T12:00:00Z'}})
 const run=macCompanion({access:{read:()=>state,take:()=>assert.fail('unexpected takeover')},owner:'owner',conversations:{ensure:owner=>{assert.equal(owner,'owner');return catalog}},manager:{state:{users:{alpha:record('alpha'),beta:record('beta')}},sessions:new Map()},jobs:{companionMessages:(key,thread)=>{assert.equal(key,thread);return [{created:1,text:key+' question',files:JSON.stringify([{name:key+'.txt',path:'/data/attachments/'+createHash('sha256').update(key).digest('hex').slice(0,24)+'/'+key+'.txt'}])}]}},stateDir:'/data',ready:()=>true,submit:()=>assert.fail('unexpected submission')})
 const current=await run({action:'view'}),other=await run({action:'view',project:'2'})
 assert.deepEqual(other.conversations.map(row=>row.id),['1','2']);assert.equal(other.activeProject,'1');assert.equal(catalog.active,'1');assert.equal(state.revision,3)
 assert.deepEqual(other.messages.map(item=>item.text),['beta question','beta result']);assert.deepEqual(other.files.map(item=>item.name),['beta.txt']);assert.equal(current.files[0].name,'alpha.txt')
 assert.deepEqual(other.messages[0].files,other.files);assert.deepEqual(other.messages[1].files,[]);assert.deepEqual(other.conversations.map(r=>[r.group,r.groupLabel]),[['shared-project','Shared'],['shared-project','Shared']])
 for(const id of ['3','4','foreign',''])await assert.rejects(run({action:'view',project:id}),/NO_CONVERSATION/)
 for(const action of ['take','send','steer'])await assert.rejects(run({...other,action}),/STALE/)
 catalog.active='2';await assert.rejects(run({...current,action:'send'}),/STALE/)
})

test('phone file, passive Mac view, contested takeover, same-turn supplement and phone return', {skip:process.platform==='win32'},async context=>{
 const dir=await mkdtemp(join(tmpdir(),'companion-')),socket=join(dir,'runtime.sock'),jobs=new DurableJobs(join(dir,'inbox.db')),access=new CompanionAccess(jobs.db)
 const owner='owner',entry={id:'1',key:owner,name:'Shared'},notices=[],submitted=[],calls=[],phoneReplies=[]
 const manager=await new SessionManager({completionMarkers:true,stateDir:dir,cwd:dir,owners:[owner],providerEnv:{},remoteControl:async()=>({active:true}),rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method,params){
  calls.push(method)
  if(method==='thread/start')return {thread:{id:'one'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
  if(method==='turn/start')return {turn:{id:'turn'}}
  if(method==='turn/steer'){submitted.push({thread:params.threadId,turn:params.expectedTurnId,text:params.input[0].text});return {turnId:'turn'}}
  return {}
 }})}).init()
 const conversations={ensure:()=>({active:'1',entries:[entry]}),realOwners:new Set([owner]),bind:message=>({...message,_conversationOwner:owner})}
 const service=new RuntimeControl(),bot={parser:{parse:wire=>wire}},received=[]
 service.onCompanion=macCompanion({access,owner,conversations,manager,jobs,stateDir:dir,ready:()=>true,submit:()=>assert.fail('must not start a second task'),notice:async(peer,text)=>notices.push(text)})
 await service.listen(socket);context.after(async()=>{manager.close();await manager.saving;await service.close();jobs.close();await rm(dir,{recursive:true,force:true})})
 const call=body=>controlRequest(socket,'POST','/mac-companion',body)
 const controller=createWeChatController({bot,manager,jobs,conversations,runtime:service,view:{directNotice:async(message,text)=>notices.push(text)},setupController:{command:()=>null},setupReceipts:{get:()=>null},classifyMessage:message=>message.text==='停止'?{kind:'session',value:{action:'stop'}}:null,normalizeVoice:message=>message,quote:()=>[],traceWire:()=>'',traceMessage:()=>'',dispatch:message=>received.push(message),phoneAccess:access.phone.bind(access)})
 const wire=(text,time=Date.now()+1)=>({text,userId:owner,raw:{message_id:randomUUID(),create_time_ms:time}})
 const inbound=async message=>{await controller.prepareBatch([message]);await controller.onMessage(bot.parser.parse(message))}
 await inbound({...wire('读文件'),files:[{fileName:'sample.txt'}]})
 const media=await prepareMedia(received[0],dir,async()=>Buffer.from('fixture'))
 jobs.add(owner,{text:'读文件来源会话中已商定的方案（供落实本轮原始请求，沿用原授权范围）：内部交接',attachments:media.attachments},'file',[received[0]._ingressId]);jobs.add('other',{text:'private'},'other')
 await manager.handle(owner,{text:'读文件',attachments:media.attachments},async text=>{phoneReplies.push(text);return {status:'accepted'}},1)
 const session=manager.sessions.get(owner)
 await manager.event(session,{method:'turn/started',params:{threadId:'one',turn:{id:'turn'}}})
 for(const id of ['turn','turn','unrelated'])await manager.event(session,{method:'turn/diff/updated',params:{threadId:'one',turnId:id,diff:'diff --git a/private b/private\n+private content'}})
 const first=await call({action:'view'});assert.equal(first.writer,'wechat');assert.equal(await readFile(first.files[0].path,'utf8'),'fixture');assert.deepEqual(first.messages.map(item=>item.text),['读文件'])
 assert.match(first.diff,/diff --git/);assert.ok(!first.messages.some(m=>m.text.includes('private content')))
 assert.deepEqual(first.progress,['本轮已有 1 个文件发生修改。'])
 const take={...first,action:'take'};const race=await Promise.allSettled([call(take),call(take)]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1)
 const active=await call({action:'view'});assert.equal(active.turn,first.turn);assert.equal(active.writer,'mac');assert.equal(new CompanionAccess(jobs.db).read().writer,'mac')
 const blocked=wire('停止');await inbound(blocked);assert.equal(received.length,1);assert.match(notices.at(-1),/Mac 正在操作/)
 const steer={...active,action:'steer',id:randomUUID(),text:'只看第二页'}
 assert.equal((await call(steer)).status,'accepted');assert.equal((await call(steer)).status,'unknown');assert.deepEqual(submitted,[{thread:'one',turn:'turn',text:'只看第二页'}])
 await manager.event(session,{method:'item/completed',params:{threadId:'one',turnId:'turn',item:{id:'progress',type:'agentMessage',phase:'commentary',text:'正在核对第二页'}}})
 await manager.event(session,{method:'item/completed',params:{threadId:'one',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'第二页结果'}}})
 await manager.event(session,{method:'turn/completed',params:{threadId:'one',turn:{id:'turn',status:'completed'}}})
 assert.deepEqual((await call({action:'view'})).messages.find(m=>m.role==='助手').updates,['正在核对第二页']);assert.deepEqual(phoneReplies,['正在核对第二页','第二页结果\n\n✅ 本轮回答结束。']);assert.equal(calls.filter(method=>method==='turn/start').length,1);assert.ok(!calls.includes('turn/interrupt'))
 assert.equal((await call({action:'view'})).messages.some(item=>item.text==='第二页结果'),true)
 assert.equal((await call({action:'view'})).progress,undefined);assert.equal((await call({action:'view'})).diff,undefined)
 const reclaim=wire('微信接手 '+active.revision);await inbound(reclaim);await inbound(reclaim);assert.equal(access.read().writer,'wechat')
 await assert.rejects(call(steer),error=>error.statusCode===409);await inbound(blocked);await inbound(wire('延迟旧消息',1));assert.equal(received.length,1)
 await inbound(wire('继续'));assert.equal(received.length,2);assert.equal(jobs.listForOwner(owner).items.length,1)
 assert.equal(hasMedia(received[0]),true)
})

test('historical and current assistant display keep original results and scope source aliases to an attachment',async()=>{
 const marker='✅ 本轮回答结束。',original=`举例：\n\n${marker}`,threadId='thread',createdAt='2026-01-01T00:00:00Z'
 const root='/data/outgoing/'+createHash('sha256').update('owner').digest('hex').slice(0,24),file={fileName:'图.png',sourcePath:'/delivery/图.jpg',path:root+'/abc.png'}
 const identity={threadId,execution:'completed',createdAt},archived={identity:{...identity,id:'old'},lastReply:original,lastOutput:{attachments:[file,{...file,path:'/foreign/abc.png'}]}}
 const record={threadId,resultArchive:[archived],resultIdentity:{...identity,id:'new',footerOffset:original.length},lastReply:original+'\n\n'+marker}
 const run=macCompanion({owner:'owner',access:{read:()=>({})},conversations:{ensure:()=>({active:'1',entries:[{id:'1',key:'owner'}]})},manager:{state:{users:{owner:record}},sessions:new Map()},jobs:{companionMessages:()=>[]},stateDir:'/data'})
 const [old,current]=(await run({action:'view'})).messages
 assert.equal(old.text,original);assert.equal(old.legacyFooter,marker);assert.equal(current.text,original);assert.equal(current.legacyFooter,undefined)
 assert.deepEqual(old.files,[{name:'图.png',path:file.path,root,sourcePath:file.sourcePath}]);assert.deepEqual(current.files,[])
 assert.equal(record.lastReply,original+'\n\n'+marker);record.resultIdentity.footerOffset=null;record.lastReply=original
 assert.equal((await run({action:'view'})).messages.at(-1).text,original)
})

test('routed WeChat receipt links to the exact retained result; target files and delivery evidence stay in that thread',async()=>{
 const entries=[{id:'5',key:'source',name:'来源'},{id:'8',key:'target',name:'开发'}],identity=(id,threadId)=>({id,taskId:'job'+id,threadId,createdAt:'2026-01-01T00:00:00Z'})
 const root='/data/outgoing/'+createHash('sha256').update('target').digest('hex').slice(0,24)
 const users={source:{threadId:'s',resultIdentity:identity('a','s'),lastReply:'任务已转交'},target:{threadId:'t',resultArchive:[{identity:{...identity('b','t'),delivery:'partial'},lastReply:'开发结果',lastOutput:{attachments:['accepted','failed','failed'].map((status,i)=>({path:root+'/'+i,status}))}}],resultIdentity:identity('c','t'),lastReply:'普通任务',supplements:Array.from({length:45},(_,i)=>({threadId:'t',created:'2026-01-02',text:String(i)}))}}
 const op={owner:'account',caller:'source',projectId:'8',name:'route_conversation_request',status:'queued',sourceTaskId:'joba',data:{projectId:'8',taskId:'jobb'}}
 const view=macCompanion({owner:'account',access:{read:()=>({writer:'wechat',revision:7})},conversations:{ensure:()=>({active:'5',entries})},manager:{state:{users,managementOperations:[op]},sessions:new Map()},jobs:{companionMessages:()=>[]},stateDir:'/data'})
 const source=await view({action:'view',project:'5',result:'b'});assert.deepEqual(source.messages.map(m=>m.text),['任务已转交']);assert.deepEqual(source.files,[])
 const link=source.messages[0].route;assert.deepEqual(link,{project:'8',result:'b'});const target=await view({action:'view',...link});assert.equal(target.activeProject,'5');assert.equal(target.writer,'wechat');const result=target.messages.find(m=>m.resultId==='b');assert.equal(result.delivery,'partial');assert.deepEqual(result.files.map(f=>f.delivery),['accepted','failed','failed']);assert.equal(target.messages.filter(m=>m.resultId==='b').length,1)
 for(const change of [{status:'unknown'},{owner:'another'},{sourceTaskId:'unrelated'}]){const prior={...op};Object.assign(op,change);assert.equal((await view({action:'view'})).messages[0].route,undefined);Object.assign(op,prior)}
 users.target.threadId='new';assert.equal((await view({action:'view'})).messages[0].route,undefined);users.target.threadId='t';entries[1].archived=true;assert.equal((await view({action:'view'})).messages[0].route,undefined)
})

test('a Mac-originated ordinary message appears once and its WeChat echo uses the same body',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mac-send-')),jobs=new DurableJobs(join(dir,'inbox.sqlite'));t.after(async()=>{jobs.close();await rm(dir,{recursive:true,force:true})})
 const notices=[],run=macCompanion({owner:'account',access:{read:()=>({writer:'mac',revision:1})},conversations:{ensure:()=>({active:'5',entries:[{id:'5',key:'source'}]})},manager:{state:{users:{source:{threadId:'thread'}}},sessions:new Map()},jobs,stateDir:dir,ready:()=>true,submit:(...args)=>jobs.add(...args),notice:async(owner,text)=>notices.push([owner,text])})
 const args={action:'send',project:'5',thread:'thread',turn:'',revision:1,id:randomUUID(),text:'Mac 新问题'}
 await run(args);await run(args);assert.deepEqual((await run({action:'view'})).messages.map(m=>m.text),[args.text]);assert.deepEqual(notices,[['account','Mac 发来：'+args.text]])
})
