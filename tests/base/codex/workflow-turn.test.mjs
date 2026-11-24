import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowTurnGuidance,discussionReplyPrefix} from '../../../src/infrastructure/agents/workflow-turn.mjs'
import {createSessionProtocol} from '../../../src/infrastructure/agents/session-protocol.mjs'
import {ASSISTANT_INSTRUCTIONS} from '../../../src/infrastructure/agents/assistant-policy.mjs'

test('workflow and layout rules come from bundled skills once',()=>{
 assert.match(ASSISTANT_INSTRUCTIONS,/description: 消息排版，在消息返回用户时使用。/)
 assert.doesNotMatch(ASSISTANT_INSTRUCTIONS,/微信排版：/)
 assert.equal((ASSISTANT_INSTRUCTIONS.match(/❓ Zero · 想问你/g)??[]).length,1)
 assert.equal((ASSISTANT_INSTRUCTIONS.match(/📋 Zero · 方案共识/g)??[]).length,1)
 assert.doesNotMatch(workflowTurnGuidance('当前消息发送失败，你有什么建议？'),/想问你|方案共识|制作中/)
})

test('turn guidance distinguishes a design idea from execution and ordinary answers',()=>{
 const idea=workflowTurnGuidance('我有个想法，想一起设计知识库的搜索机制，先比较两种方案')
 assert.match(idea,/方案讨论意向/)
 assert.match(idea,/design-discussion skill/)
 for(const request of [
  '你觉得我们是否需要单独做一个桌面版？',
  '我们要不要单独开发桌面客户端？',
  '当前的消息经常会出现发送失败，你有什么建议么？',
 ]){
  assert.match(workflowTurnGuidance(request),/方案讨论意向/)
  assert.match(workflowTurnGuidance(request),/design-discussion skill/)
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
 assert.match(workflowTurnGuidance('请实现这个项目','plan'),/design-discussion skill/)
 assert.doesNotMatch(workflowTurnGuidance('请实现这个项目','plan'),/Plan Mode|只调研和制定方案/)
 assert.match(workflowTurnGuidance('那移动端呢？'),/简短回复承接上文/)
 assert.doesNotMatch(workflowTurnGuidance('同意'),/想问你|方案共识|制作中/)
})

test('turn start sends the guidance as developer instructions without altering the request',async()=>{
 let sent
 const rpc={request:async(method,params)=>{assert.equal(method,'turn/start');sent=params;return {turn:{id:'turn'}}}}
 await createSessionProtocol().startTurn(rpc,{threadId:'thread',input:[{type:'text',text:'想一起讨论搜索机制'}],model:'test-model',workflowRequest:'想一起讨论搜索机制'})
 assert.equal(sent.input[0].text,'想一起讨论搜索机制')
 assert.match(sent.collaborationMode.settings.developer_instructions,/方案讨论意向/)
 assert.equal(sent.collaborationMode.mode,'default')
})

test('successive short turns preserve the same thread and distinguish agreement, continuation and result lookup',async()=>{
 const sent=[]
 const rpc={request:async(method,params)=>{assert.equal(method,'turn/start');sent.push(params);return {turn:{id:'turn-'+sent.length}}}}
 const protocol=createSessionProtocol()
 const requests=[
  '我们要不要为知识库增加搜索？先讨论一下',
  '对来源会话中已商定的方案（供落实本轮原始请求）：先比较本地索引和远端搜索。',
  '继续',
  '请按刚才选定的方案实现知识库搜索',
  '结果',
 ]
 for(const request of requests)await protocol.startTurn(rpc,{threadId:'same-thread',input:[{type:'text',text:request}],model:'test-model',workflowRequest:request})
 assert.deepEqual(sent.map(turn=>turn.threadId),Array(5).fill('same-thread'))
 assert.deepEqual(sent.map(turn=>turn.input[0].text),requests)
 const guidance=sent.map(turn=>turn.collaborationMode.settings.developer_instructions)
 assert.match(guidance[0],/方案讨论意向/)
 assert.match(guidance[1],/最近一项明确建议或选择的简短确认/)
 assert.match(guidance[1],/此前只在讨论|原本只在讨论/)
 assert.doesNotMatch(guidance[1],/本轮有方案讨论意向/)
 assert.match(guidance[2],/已获授权的工作/)
 assert.doesNotMatch(guidance[3],/简短确认|结果或状态查询|方案讨论意向/)
 assert.match(guidance[4],/结果或状态查询/)
 assert.match(guidance[4],/不新建任务、不重做/)
})

test('short confirmations keep project ownership and ask once when the referent is ambiguous',()=>{
 for(const request of ['对','同意。','收到','继续','结果？']){
  const guidance=workflowTurnGuidance(request)
  assert.match(guidance,/若多个项目或任务都可能是所指且会改变操作，只问一个必要问题/)
  assert.doesNotMatch(guidance,/本轮有方案讨论意向/)
 }
 assert.match(workflowTurnGuidance('对'),/不当作新议题/)
 assert.match(workflowTurnGuidance('收到'),/不当作新议题或新的实施授权/)
 assert.match(workflowTurnGuidance('继续'),/此前只在讨论，继续讨论/)
 assert.match(workflowTurnGuidance('结果'),/沿本会话已确认的任务归属核对现有结果/)
 assert.doesNotMatch(workflowTurnGuidance('知识库项目结果'),/这是最近任务的结果或状态查询/)
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
