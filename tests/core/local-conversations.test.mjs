import test from 'node:test'
import assert from 'node:assert/strict'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {conversationInput} from '../../src/interfaces/wechat/conversation-command.mjs'
import {createLocalConversationBackend} from '../../src/infrastructure/agents/local-conversation-backend.mjs'

function fixture(){
 const manager={agentName:'Claude',state:{users:{owner:{threadId:'original'}}},owners:new Set(['owner']),sessions:new Map(),questions:new Map(),save:async()=>{}}
 const conversations=new TextConversations(manager,['owner'],conversationInput,createLocalConversationBackend())
 manager.connect=async key=>{
  const saved=manager.state.users[key]??={}
  saved.threadId??=`local-${conversations.entry(key).id}`
  return {threadId:saved.threadId}
 }
 return {manager,conversations}
}

test('local backend shares navigation and daily selection without remote catalog operations',async()=>{
 const {manager,conversations}=fixture(),output=[]
 const send=async text=>conversations.control(conversations.bind({userId:'owner',text}),value=>output.push(value))
 await send('新建 项目')
 assert.equal(conversations.find('owner').id,'2')
 assert.match(output.at(-1),/Claude 会话2/)
 await send('列表')
 assert.match(output.at(-1),/^项目列表\n2\. 项目/)
 await send('删除2')
 assert.match(output.at(-1),/暂不支持/)
 assert.equal(conversations.find('owner','2').deleted,undefined)
 await send('日常')
 assert.equal(conversations.find('owner').id,'1')
 assert.equal(manager.beforeConversationConnect,undefined)
})

test('unconfirmed local selection rolls back without reporting success',async()=>{
 const {manager,conversations}=fixture(),output=[]
 manager.connect=async()=>({threadId:'wrong'})
 const message=conversations.bind({userId:'owner',text:'新建 项目'})
 manager.state.users[message.userId]={threadId:'expected'}
 await assert.rejects(conversations.control(message,value=>output.push(value)),/未确认目标会话/)
 assert.equal(conversations.find('owner').id,'1')
 assert.deepEqual(output,[])
})
