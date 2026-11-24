import test from 'node:test'
import assert from 'node:assert/strict'
import {handoffReply} from '../../src/application/conversations/handoff-reply.mjs'

const session={userId:'source',taskId:'source-task',startedAt:100}
const operation={id:'operation',name:'route_conversation_request',caller:'source',sourceTaskId:'source-task',status:'queued',createdAt:110,data:{taskId:'target-task',name:'知识库'}}
const target={id:'target-task',state:'pending',input:{projectDispatch:{operationId:'operation'}}}
const result=(op=operation,job=target)=>handoffReply({managementOperations:[op]},{get:()=>job},session)

test('confirmed handoff reports target queue, running and ended states without claiming source completion',()=>{
 assert.equal(result(),'已交给知识库会话，目前排队中；结果将在目标会话返回。')
 for(const state of ['starting','bound','submitted','waiting_desktop'])assert.match(result(operation,{...target,state}),/正在处理；结果将在目标会话返回/)
 assert.match(result(operation,{...target,state:'done',outcome:'completed'}),/目标任务已结束；请查看目标会话的结果/)
 assert.match(result(operation,{...target,state:'done',outcome:'not_confirmed'}),/结果未确认成功/)
 assert.match(result(operation,{...target,state:'cancelled'}),/随后取消或未执行/)
 assert.match(result(operation,{...target,state:'uncertain'}),/执行或投递结果待核对/)
})

test('unconfirmed, rejected and changed routes never claim target accepted the task',()=>{
 for(const status of ['unknown','executing','pending'])assert.match(result({...operation,status}),/无法判断目标会话是否已接收/)
 for(const status of ['rejected','not_executed'])assert.match(result({...operation,status}),/转交未成功/)
 assert.match(result(operation,null),/任务状态待核对/)
 assert.match(result(operation,{...target,input:{projectDispatch:{operationId:'other'}}}),/任务状态待核对/)
 assert.equal(handoffReply({managementOperations:[operation]},{get:()=>target},{...session,taskId:'other-task'}),null)
 const laterRejection={...operation,id:'later',status:'rejected',createdAt:120}
 assert.equal(handoffReply({managementOperations:[operation,laterRejection]},{get:()=>target},session),result())
})
