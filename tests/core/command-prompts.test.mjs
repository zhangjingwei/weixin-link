import test from 'node:test'
import assert from 'node:assert/strict'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {conversationInput} from '../../src/interfaces/wechat/conversation-command.mjs'
import {createCommandClassifier} from '../../src/wechat/command-classifier.mjs'
import {setupCommand} from '../../src/setup/setup-controller.mjs'
import {createReceiveMessage} from '../../src/application/intake/receive-message.mjs'

function fixture(state={users:{alice:{},bob:{}}}){
 const manager={state,owners:new Set(['alice','bob']),sessions:new Map(),questions:new Map(),save:async()=>{}}
 return {manager,router:new TextConversations(manager,['alice','bob'],conversationInput)}
}

test('free-text commands prompt first and consume one following text message',async()=>{
 const {router}=fixture(),classify=createCommandClassifier()
 for(const [word,answer,action,field] of [
  ['补充','先核对','steer','text'],['计划','修复测试','plan','text'],['长任务','整理仓库','goal','objective'],
  ['命名','项目甲','rename','name'],['搜索','关键词','search','q'],
 ]){
  const start=router.bind({userId:'alice',text:word}),out=[]
  await router.control(start,value=>out.push(value))
  assert.match(out[0],/下一条纯文字/)
  assert.equal(router.ensure('alice').prompt.target,start._conversationCommand.target)
  const reply=router.bind({userId:'alice',text:answer})
  const command=reply._sessionCommand??reply._conversationCommand
  assert.equal(command.action,action)
  assert.equal(command[field],answer)
  assert.equal(classify(reply).value.action,action)
  assert.equal(router.ensure('alice').prompt,undefined)
 }
 const start=router.bind({userId:'alice',text:'新建'}),before=router.ensure('alice').entries.length
 assert.equal(start._conversationCommand.action,'prompt')
 assert.equal(router.ensure('alice').entries.length,before)
 const created=router.bind({userId:'alice',text:'项目乙'})
 assert.equal(created._conversationCommand.action,'new')
 assert.equal(created._conversationCommand.name,'项目乙')
 assert.equal(router.ensure('alice').entries.length,before+1)
})

test('prompt state survives reload, stays within its owner, and can be cancelled',()=>{
 const {manager,router}=fixture()
 router.bind({userId:'alice',text:'补充'})
 const restored=fixture(structuredClone(manager.state)).router
 assert.equal(restored.bind({userId:'bob',text:'普通消息'})._sessionCommand,undefined)
 const answer=restored.bind({userId:'alice',text:'继续检查',raw:{message_id:'answer-1'}})
 assert.deepEqual(answer._sessionCommand,{action:'steer',text:'继续检查'})
 assert.deepEqual(restored.bind({userId:'alice',text:'继续检查',raw:{message_id:'answer-1'}})._sessionCommand,answer._sessionCommand)
 restored.bind({userId:'alice',text:'补充'})
 const reserved=restored.bind({userId:'alice',text:'列表',raw:{message_id:'answer-2'}})
 const again=fixture(structuredClone(restored.manager.state)).router.bind({userId:'alice',text:'列表',raw:{message_id:'answer-2'}})
 assert.deepEqual(again._sessionCommand,reserved._sessionCommand)
 assert.equal(again._conversationCommand,null)
 restored.bind({userId:'alice',text:'搜索'})
 assert.equal(restored.bind({userId:'alice',text:'取消'})._conversationCommand.action,'promptCancel')
 assert.equal(restored.ensure('alice').prompt,undefined)
})

test('invalid or media input does not consume a prompt; stop and approval commands remain controls',()=>{
 const {manager,router}=fixture()
 router.bind({userId:'alice',text:'命名'})
 assert.equal(router.bind({userId:'alice',text:'x'.repeat(41)})._conversationCommand.action,'promptInvalid')
 assert.equal(router.ensure('alice').prompt.target,'rename')
 router.bind({userId:'alice',text:'图片说明',images:[{}]})
 router.bind({userId:'alice',images:[{}]})
 assert.equal(router.ensure('alice').prompt.target,'rename')
 manager.questions.set('abc123',{session:{userId:'alice'}})
 assert.equal(router.bind({userId:'alice',text:'批准'})._conversationCommand.target,'approvalChoice')
 assert.equal(router.ensure('alice').prompt.target,'approvalChoice')
 assert.equal(router.bind({userId:'alice',text:'停止'})._sessionCommand.action,'stop')
 assert.equal(router.ensure('alice').prompt,undefined)
})

test('old inline free-text commands remain ordinary messages',()=>{
 const {router}=fixture()
 for(const text of ['补充 内容','计划 需求','长任务 目标','新建 项目名','命名 名称','搜索 关键词']){
  const message=router.bind({userId:'alice',text})
  assert.equal(message._conversationCommand,null)
  assert.equal(message._sessionCommand,undefined)
 }
})

test('guide and status can be viewed during a project-name prompt without consuming the answer',async()=>{
 const {router}=fixture(),classify=createCommandClassifier()
 const start=router.bind({userId:'alice',text:'新建项目',raw:{message_id:'start'}})
 await router.control(start,()=>{})
 const guide=router.bind({userId:'alice',text:'guide',raw:{message_id:'guide'}})
 guide._setupAction=setupCommand(guide.text)
 assert.equal(classify(guide).kind,'setup')
 assert.equal(guide._setupAction,'manualEn')
 assert.equal(router.ensure('alice').prompt.target,'newProject')
 const status=router.bind({userId:'alice',text:'status',raw:{message_id:'status'}})
 assert.equal(classify(status).value.action,'status')
 assert.equal(router.ensure('alice').prompt.target,'newProject')
 const answer=router.bind({userId:'alice',text:'demo',raw:{message_id:'answer'}})
 assert.deepEqual(answer._conversationCommand,{action:'projectFolderPrompt',name:'demo'})
 assert.equal(classify(answer).kind,'conversation')
 assert.equal(router.ensure('alice').prompt.target,'projectFolder')
})

test('command-shaped project names cannot turn into setup, restart, or upgrade commands',()=>{
 const classify=createCommandClassifier()
 for(const name of ['setup','restart','upgrade','memory-on']){
  const {manager,router}=fixture()
  router.bind({userId:'alice',text:'新建项目',raw:{message_id:'start'}})
  const receive=createReceiveMessage({manager,jobs:{findCaptured:()=>null},conversations:router,normalizeVoice:message=>message,setupReceipts:{get:()=>null},setupController:{command:setupCommand}})
  const answer=receive.prepare({userId:'alice',text:name,raw:{message_id:'answer'}},{traceId:'test',quote:()=>[]})
  assert.deepEqual(answer._conversationCommand,{action:'projectFolderPrompt',name})
  assert.equal(answer._promptReply,true)
  assert.equal(answer._setupAction,null)
  assert.equal(classify(answer).kind,'conversation')
  assert.equal(router.ensure('alice').prompt.target,'projectFolder')
  const replay=fixture(structuredClone(manager.state)).router.bind({userId:'alice',text:name,raw:{message_id:'answer'}})
  assert.equal(replay._promptReply,true)
  assert.equal(classify(replay).kind,'conversation')
 }
})
