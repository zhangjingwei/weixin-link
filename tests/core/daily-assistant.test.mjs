import test from 'node:test'
import assert from 'node:assert/strict'
import {TextConversations,conversationCommand} from '../../src/core/text-conversations.mjs'
const fixture=()=>{
 const calls=[],manager={state:{users:{alice:{threadId:'original-thread'}}},owners:new Set(['alice','bob']),sessions:new Map(),questions:new Map(),save:async()=>{}}
 const router=new TextConversations(manager,['alice','bob'])
 router.refreshTitles=async()=>{}
 manager.connect=async key=>{const id=manager.state.users[key]?.threadId??'project-thread';return {threadId:id,rpc:{request:async(method,p)=>{calls.push([method,p]);assert.equal(method,'thread/read');return {thread:{id,name:'Existing conversation'}}}}}}
 return {manager,router,calls}
}
test('daily command is exact and media captions remain ordinary input',()=>{
 assert.deepEqual(conversationCommand('日常助手'),{action:'daily'})
 assert.deepEqual(conversationCommand('返回日常助手'),{action:'daily'})
 for(const text of ['帮我设计日常助手','日常助手如何工作','日常助手 项目'])assert.equal(conversationCommand(text),null)
 const {router}=fixture();const project=router.bind({userId:'alice',text:'新建 Project'})
 assert.equal(router.bind({userId:'alice',text:'日常助手',images:[{}]}).userId,project.userId)
})
test('daily entry reuses original owned thread without creating threads or stopping project work',async()=>{
 const {manager,router,calls}=fixture(),project=router.bind({userId:'alice',text:'新建 Project'})
 manager.sessions.set(project.userId,{busy:true,queue:['keep']})
 const count=router.ensure('alice').entries.length,out=[],message=router.bind({userId:'alice',text:'日常助手'})
 await router.control(message,async s=>out.push(s))
 assert.equal(message.userId,'alice');assert.equal(router.find('alice').key,'alice')
 assert.equal(router.ensure('alice').entries.length,count);assert.equal(manager.state.users.alice.threadId,'original-thread')
 assert.equal(manager.sessions.get(project.userId).busy,true);assert.deepEqual(manager.sessions.get(project.userId).queue,['keep'])
 assert.equal(calls.length,1);assert.match(out[0],/已返回日常助手/)
})
test('daily designation survives state reload and later changes to active project',()=>{
 const {manager,router}=fixture();const project=router.bind({userId:'alice',text:'新建 Work'})
 const restored=new TextConversations({...manager,state:structuredClone(manager.state),owners:new Set(['alice','bob'])},['alice','bob'])
 assert.equal(restored.find('alice').key,project.userId)
 assert.equal(restored.bind({userId:'alice',text:'日常助手'}).userId,'alice')
 assert.equal(restored.bind({userId:'bob',text:'日常助手'}).userId,'bob')
})
test('daily selection respects frozen receipt bindings and duplicate messages',()=>{
 const {router}=fixture();const first=router.bind({userId:'alice',text:'日常助手',raw:{message_id:'daily-1'}})
 const project=router.bind({userId:'alice',text:'新建 Work'})
 const duplicate=router.bind({userId:'alice',text:'日常助手',raw:{message_id:'daily-1'}})
 assert.equal(duplicate.userId,first.userId);assert.equal(duplicate._conversationCommand.id,first._conversationCommand.id)
 assert.equal(router.find('alice').key,project.userId)
 assert.equal(router.bind({userId:'alice',text:'continue'}).userId,project.userId)
})
test('archived or missing daily thread is not replaced, and official selection failure rolls back',async()=>{
 const {router,manager}=fixture();const home=router.find('alice'),project=router.bind({userId:'alice',text:'新建 Work'})
 home.archived=true;let output=[];await router.control(router.bind({userId:'alice',text:'日常助手'}),async s=>output.push(s))
 assert.match(output[0],/还原1/);assert.equal(router.find('alice').key,project.userId)
 home.archived=false;home.archiveSync='missing';output=[];await router.control(router.bind({userId:'alice',text:'日常助手'}),async s=>output.push(s))
 assert.match(output[0],/未新建替代会话/)
 delete home.archiveSync;manager.connect=async()=>{throw Error('offline')}
 await assert.rejects(router.control(router.bind({userId:'alice',text:'日常助手'}),async()=>{}),/offline/)
 assert.equal(router.find('alice').key,project.userId)
})
test('explicit daily entry after permanent deletion creates one replacement and remains stable',()=>{
 const {router}=fixture();const old=router.find('alice');old.deleted=true;old.archived=true
 const first=router.bind({userId:'alice',text:'日常助手'}),id=router.ensure('alice').dailyId
 assert.notEqual(first.userId,old.key);assert.equal(router.bind({userId:'alice',text:'日常助手'}).userId,first.userId)
 assert.equal(router.ensure('alice').dailyId,id);assert.equal(router.ensure('alice').entries.length,2)
})
