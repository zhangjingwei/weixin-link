import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {CompanionAccess} from '../../src/infrastructure/storage/companion-access.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {macCompanion} from '../../src/application/conversations/mac-companion.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {createWeChatController} from '../../src/interfaces/controllers/wechat-controller.mjs'
import {prepareMedia,hasMedia} from '../../src/infrastructure/media/media-input.mjs'
import {controlRequest,RuntimeControl} from '../../src/infrastructure/runtime/runtime-control.mjs'

test('phone file, passive Mac view, contested takeover, same-turn supplement and phone return', {skip:process.platform==='win32'},async context=>{
 const dir=await mkdtemp(join(tmpdir(),'companion-')),socket=join(dir,'runtime.sock'),jobs=new DurableJobs(join(dir,'inbox.db')),access=new CompanionAccess(jobs.db)
 const owner='owner',entry={id:'1',key:owner,name:'Shared'},notices=[],submitted=[],calls=[],phoneReplies=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:[owner],providerEnv:{},remoteControl:async()=>({active:true}),rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method,params){
  calls.push(method)
  if(method==='thread/start')return {thread:{id:'one'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
  if(method==='turn/start')return {turn:{id:'turn'}}
  if(method==='turn/steer'){submitted.push({thread:params.threadId,turn:params.expectedTurnId,text:params.input[0].text});return {turnId:'turn'}}
  return {}
 }})}).init()
 const conversations={find:()=>entry,realOwners:new Set([owner]),bind:message=>({...message,_conversationOwner:owner})}
 const service=new RuntimeControl(),bot={parser:{parse:wire=>wire}},received=[]
 service.onCompanion=macCompanion({access,owner,conversations,manager,jobs,stateDir:dir,ready:()=>true,submit:()=>assert.fail('must not start a second task'),notice:async(peer,text)=>notices.push(text)})
 await service.listen(socket);context.after(async()=>{manager.close();await manager.saving;await service.close();jobs.close();await rm(dir,{recursive:true,force:true})})
 const call=body=>controlRequest(socket,'POST','/mac-companion',body)
 const controller=createWeChatController({bot,manager,jobs,conversations,runtime:service,view:{directNotice:async(message,text)=>notices.push(text)},setupController:{command:()=>null},setupReceipts:{get:()=>null},classifyMessage:message=>message.text==='停止'?{kind:'session',value:{action:'stop'}}:null,normalizeVoice:message=>message,quote:()=>[],traceWire:()=>'',traceMessage:()=>'',dispatch:message=>received.push(message),phoneAccess:access.phone.bind(access)})
 const wire=(text,time=Date.now()+1)=>({text,userId:owner,raw:{message_id:randomUUID(),create_time_ms:time}})
 const inbound=async message=>{await controller.prepareBatch([message]);await controller.onMessage(bot.parser.parse(message))}
 await inbound({...wire('读文件'),files:[{fileName:'sample.txt'}]})
 const media=await prepareMedia(received[0],dir,async()=>Buffer.from('fixture'))
 jobs.add(owner,{text:'读文件',attachments:media.attachments},'file',[received[0]._ingressId]);jobs.add('other',{text:'private'},'other')
 await manager.handle(owner,{text:'读文件',attachments:media.attachments},async text=>{phoneReplies.push(text);return {status:'accepted'}},1)
 const session=manager.sessions.get(owner)
 await manager.event(session,{method:'turn/started',params:{threadId:'one',turn:{id:'turn'}}})
 const first=await call({action:'view'});assert.equal(first.writer,'wechat');assert.equal(await readFile(first.files[0].path,'utf8'),'fixture');assert.deepEqual(first.messages.map(item=>item.text),['读文件'])
 const take={...first,action:'take'};const race=await Promise.allSettled([call(take),call(take)]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1)
 const active=await call({action:'view'});assert.equal(active.turn,first.turn);assert.equal(active.writer,'mac');assert.equal(new CompanionAccess(jobs.db).read().writer,'mac')
 const blocked=wire('停止');await inbound(blocked);assert.equal(received.length,1);assert.match(notices.at(-1),/Mac 正在操作/)
 const steer={...active,action:'steer',id:randomUUID(),text:'只看第二页'}
 assert.equal((await call(steer)).status,'accepted');assert.equal((await call(steer)).status,'unknown');assert.deepEqual(submitted,[{thread:'one',turn:'turn',text:'只看第二页'}])
 await manager.event(session,{method:'item/completed',params:{threadId:'one',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'第二页结果'}}})
 await manager.event(session,{method:'turn/completed',params:{threadId:'one',turn:{id:'turn',status:'completed'}}})
 assert.deepEqual(phoneReplies,['第二页结果']);assert.equal(calls.filter(method=>method==='turn/start').length,1);assert.ok(!calls.includes('turn/interrupt'))
 assert.equal((await call({action:'view'})).messages.some(item=>item.text==='第二页结果'),true)
 const reclaim=wire('微信接手 '+active.revision);await inbound(reclaim);await inbound(reclaim);assert.equal(access.read().writer,'wechat')
 await assert.rejects(call(steer),error=>error.statusCode===409);await inbound(blocked);await inbound(wire('延迟旧消息',1));assert.equal(received.length,1)
 await inbound(wire('继续'));assert.equal(received.length,2);assert.equal(jobs.listForOwner(owner).items.length,1)
 assert.equal(hasMedia(received[0]),true)
})
