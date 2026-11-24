import test from 'node:test'
import assert from 'node:assert/strict'
import {classificationInput,classificationDecision} from '../../src/infrastructure/agents/entry-classification.mjs'
import {entryPlan} from '../../src/domain/tasks/entry-plan.mjs'

test('classification projection retains targets and exact request without execution details',()=>{
 const text='不要改代码，先讨论知识库怎么优化',input={text,currentProjectId:'1',projects:[{projectId:'2',name:'知识库',task:{id:'private-job',turnId:'private-turn',text:'private-body'},queued:7,queuedTasks:[{taskId:'q',title:'修复搜索',input:'private-input'}],threadId:'private-thread'}],pendingClarification:{text:'检查搜索',question:'哪个项目',createdAt:1},currentAttachments:[{name:'资料.pdf',kind:'files',path:'/private/file'}]}
 const projected=classificationInput(input)
 assert.equal(projected.text,text);assert.equal(projected.projects[0].running,true);assert.equal(projected.projects[0].queued,7)
 assert.deepEqual(projected.projects[0].queuedTasks,[{taskId:'q',title:'修复搜索'}]);assert.equal(projected.pendingClarification.text,'检查搜索')
 assert(!JSON.stringify(projected).includes('private'));assert(!JSON.stringify(projected).includes('createdAt'))
 assert.equal(input.projects[0].task.turnId,'private-turn')
})
test('compact wire plans preserve application validation for multi-project execution',()=>{
 const projects=[{projectId:'1',name:'知识库'},{projectId:'2',name:'工具箱'}],text='知识库检查搜索，工具箱优化页面'
 const steps=[{action:'task',projectId:'1',requestedProjectName:'知识库',text:'知识库检查搜索',dependsOn:[]},{action:'task',projectId:'2',requestedProjectName:'工具箱',text:'工具箱优化页面',dependsOn:[0]}]
 const result=classificationDecision({steps,useClarification:false});assert.equal(result.action,'batch');assert.equal(entryPlan(result,text,projects).length,2)
 assert.throws(()=>entryPlan(classificationDecision({steps:[steps[0],{...steps[1],text:'编造的任务'}],useClarification:false}),text,projects),/ENTRY_PLAN_INVALID/)
 assert.deepEqual(classificationDecision({steps:[{action:'status',projectId:'1'}],useClarification:true}),{action:'status',projectId:'1',steps:[],useClarification:true})
 assert.throws(()=>classificationDecision({steps:[],useClarification:false}),/OUTPUT_INVALID/)
})
