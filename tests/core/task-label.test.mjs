import test from 'node:test'
import assert from 'node:assert/strict'
import {localTaskLabel,localCompletion} from '../../src/domain/tasks/task-label.mjs'
test('completion shows only outcome while task identity remains internal',()=>{const task=localTaskLabel({text:'检查 Spark 上的 Mova 项目\n\n第二段请求正文'},'abcdef123456');assert.deepEqual(task,{id:'abcdef12',title:'检查 Spark 上的 Mova 项目'});assert.equal(localCompletion('✅ 本轮回答结束。',task),'✅ 本轮回答结束。')})
test('long multiline request title stays short and does not split surrogate pairs',()=>{const label=localTaskLabel('😀'.repeat(70)+'\nsecret second line','123456789');assert.equal(Array.from(label.title).length,36);assert.equal(label.id,'12345678')})
