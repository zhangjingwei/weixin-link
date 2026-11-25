import test from 'node:test'
import assert from 'node:assert/strict'
import {deliver} from '../../src/application/conversations/delivery.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
function fixture(){
 const entry={key:'background',id:'2',name:'官网设计',owner:'owner'},sent=[],saved=[]
 const context={root:{owner:{entries:[{key:'foreground',id:'1',owner:'owner'},entry]}},entry:k=>k==='background'?entry:undefined,find:()=>({key:'foreground'}),recipient:()=> 'owner',serialize:(_,fn)=>fn(),label:(_,v)=>typeof v==='string'?'【会话2 · 官网设计】\n'+v:{...v,text:'【会话2 · 官网设计】\n'+v.text},manager:{save:async()=>saved.push(true)}}
 return {context,entry,sent,saved,send:async(...args)=>{sent.push(args);return {status:'accepted'}}}
}
test('background approval and final bundle send once with ownership label, without changing navigation or persisting replay copies',async()=>{
 for(const notificationKind of ['interaction','result']){
  const f=fixture(),value=notificationKind==='result'?{kind:'bundle',text:'结果',attachments:[{id:'authorized-reference'}]}:'请审批'
  const result=await deliver(f.context,'background',value,{notificationKind},f.send)
  assert.equal(result.status,'accepted');assert.equal(f.sent.length,1);assert.match(typeof f.sent[0][1]==='string'?f.sent[0][1]:f.sent[0][1].text,/会话2 · 官网设计/)
  if(notificationKind==='result')assert.deepEqual(f.sent[0][1].attachments,value.attachments)
  assert.equal(f.entry.unread,undefined);assert.equal(f.context.find().key,'foreground')
 }
})
test('ordinary background progress still defers, deleted/stale interactions do not send and unknown delivery is never retried',async()=>{
 const f=fixture();assert.equal((await deliver(f.context,'background','progress',{},f.send)).status,'deferred');assert.equal(f.sent.length,0);assert.equal(f.entry.unread.length,1)
 assert.equal((await deliver(f.context,'background','approval',{notificationKind:'interaction',current:()=>false},f.send)).status,'cancelled')
 f.entry.deleted=true;assert.equal((await deliver(f.context,'background','result',{notificationKind:'result'},f.send)).status,'cancelled');assert.equal(f.sent.length,0)
 const unknown=fixture();let count=0
 assert.equal((await deliver(unknown.context,'background','approval',{notificationKind:'interaction'},async()=>{count++;return {status:'unknown'}})).status,'unknown');assert.equal(count,1);assert.equal(unknown.entry.unread,undefined)
})
test('session notification metadata is explicit, not inferred from message prose',async()=>{
 const manager=new SessionManager({owners:['owner'],cwd:'/tmp',stateDir:'/tmp',rpcFactory:()=>{throw Error('no live connection')}}),sent=[]
 manager.log=()=>{};const session={userId:'owner',reply:async(text,options)=>{sent.push({text,options});return {status:'accepted'}}}
 await manager.notify(session,'请批准操作',undefined,'interaction')
 await manager.emit(session,'这是最终结果',undefined,false,'result')
 await manager.emit(session,'批准完成等文字只是正文')
 assert.deepEqual(sent.map(s=>s.options.notificationKind),['interaction','result',undefined])
})
