import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowTurnGuidance,discussionReplyPrefix} from '../../../src/infrastructure/agents/workflow-turn.mjs'
import {createSessionProtocol} from '../../../src/infrastructure/agents/session-protocol.mjs'

test('turn guidance distinguishes a design idea from execution and ordinary answers',()=>{
 const idea=workflowTurnGuidance('我有个想法，想一起设计知识库的搜索机制，先比较两种方案')
 assert.match(idea,/方案讨论意向/)
 assert.match(idea,/不因提到项目就转交执行/)
 for(const request of [
  '你觉得我们是否需要单独做一个桌面版？',
  '我们要不要单独开发桌面客户端？',
 ]){
  assert.match(workflowTurnGuidance(request),/方案讨论意向/)
  assert.match(workflowTurnGuidance(request),/可见讨论标记/)
 }
 for(const request of [
  '请修复方案设计 skill 的触发机制并更新本地实例',
  '我同意刚才的方案，继续实现并推送开发分支',
  '知识库最近的搜索是什么？',
  '为什么会固定为 tz？',
  '你觉得今天会下雨吗？',
  '桌面版现在支持哪些系统？',
 ])assert.doesNotMatch(workflowTurnGuidance(request),/方案讨论意向/)
 assert.match(workflowTurnGuidance('想一起讨论知识库设计方案\n来源会话中已商定的方案（供落实本轮原始请求）：请修改代码'),/方案讨论意向/)
 assert.match(workflowTurnGuidance('请实现这个项目','plan'),/不修改项目/)
 assert.match(workflowTurnGuidance('那移动端呢？'),/接续讨论的简短追问沿用上文/)
})

test('turn start sends the guidance as developer instructions without altering the request',async()=>{
 let sent
 const rpc={request:async(method,params)=>{assert.equal(method,'turn/start');sent=params;return {turn:{id:'turn'}}}}
 await createSessionProtocol().startTurn(rpc,{threadId:'thread',input:[{type:'text',text:'想一起讨论搜索机制'}],model:'test-model',workflowRequest:'想一起讨论搜索机制'})
 assert.equal(sent.input[0].text,'想一起讨论搜索机制')
 assert.match(sent.collaborationMode.settings.developer_instructions,/方案讨论意向/)
 assert.equal(sent.collaborationMode.mode,'default')
})

test('discussion marker is added once only for clear design discussion',()=>{
 const request='你觉得我们是否需要单独做一个桌面版？'
 assert.equal(discussionReplyPrefix(request,'建议先验证网页端需求。'),'💡 Zero · 方案讨论\n')
 assert.equal(discussionReplyPrefix(request,'💡 Zero · 方案讨论\n建议先验证网页端需求。'),'')
 assert.equal(discussionReplyPrefix(request,'❓ Zero · 想问你\n主要给谁用？'),'')
 assert.equal(discussionReplyPrefix('桌面版现在支持哪些系统？','目前支持 macOS。'),'')
 assert.equal(discussionReplyPrefix('请开发桌面版','已经完成。'),'')
 assert.equal(discussionReplyPrefix('那移动端呢？','建议沿用网页版。'),'')
})
