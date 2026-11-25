import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationInput} from '../../src/interfaces/wechat/conversation-command.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {controlCommand} from '../../src/interfaces/wechat/control-command.mjs'

test('retired plan command is ordinary text and an old prompt no longer captures replies',()=>{
 for(const text of ['计划','plan','PLAN']){
  assert.equal(controlCommand(text),null)
  assert.deepEqual(conversationInput(text),{command:null})
 }
 const root={active:'1',entries:[{id:'1',key:'alice',name:'原有对话'}],prompt:{target:'plan',key:'alice',id:'1'}}
 const manager={state:{users:{alice:{}},textConversations:{alice:root}},owners:new Set(),sessions:new Map()}
 const router=new TextConversations(manager,['alice'],conversationInput)
 const message=router.bind({userId:'alice',text:'请设计搜索机制'})
 assert.equal(root.prompt,undefined)
 assert.equal(message._promptReply,false)
 assert.equal(message._sessionCommand,undefined)
 root.bindings.old={key:'alice',command:{action:'prompt',target:'plan'},sessionCommand:null,promptReply:false}
 const replay=router.bind({userId:'alice',text:'计划',raw:{message_id:'old'}})
 assert.equal(replay._conversationCommand,null)
 root.bindings.reply={key:'alice',command:null,sessionCommand:{action:'plan',text:'请设计搜索机制'},promptReply:true}
 const oldReply=router.bind({userId:'alice',text:'请设计搜索机制',raw:{message_id:'reply'}})
 assert.equal(oldReply._sessionCommand,null)
 assert.equal(oldReply._promptReply,false)
})

test('removing the legacy daily designation preserves threads, active selection and replay bindings',async()=>{
 const entries=[{id:'1',key:'alice',name:'购物计划'},{id:'2',key:'work',name:'工具箱'}]
 const root={dailyId:'1',active:'2',entries,bindings:{old:{key:'alice',command:{action:'daily',id:'1'}}}}
 const users={alice:{threadId:'first'},work:{threadId:'second'}}
 const manager={state:{users,textConversations:{alice:root}},owners:new Set(),sessions:new Map()}
 const router=new TextConversations(manager,['alice'],conversationInput)
 assert.equal(Object.hasOwn(root,'dailyId'),false)
 for(const text of ['日常','daily','今天聊点别的']){
  const message=router.bind({userId:'alice',text})
  assert.equal(message.userId,'work')
  assert.equal(await router.control(message,assert.fail),false)
 }
 const replay=router.bind({userId:'alice',text:'日常',raw:{message_id:'old'}})
 assert.equal(replay.userId,'alice')
 assert.equal(await router.control(replay,assert.fail),true)
 assert.equal(root.active,'2')
 assert.equal(root.entries.length,2)
 assert.deepEqual(users,{alice:{threadId:'first'},work:{threadId:'second'}})
 const output=[]
 router.refreshTitles=async()=>{}
 await router.listBoundConversations('alice',s=>output.push(s))
 assert.match(output[0],/1\. 购物计划/)
 assert.match(output[0],/2\. 工具箱 \[当前\]/)
})
