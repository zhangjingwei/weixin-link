import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {grade} from '../../../src/infrastructure/agents/evals/grade.mjs'

test('skill grader detects missing headings, duplicate markers, extra questions and excessive consensus text',()=>{
 assert.equal(grade('💡 Zero · 方案讨论\n先用表格。',{startsWith:'💡 Zero · 方案讨论',contains:['表格']}).pass,true)
 assert.deepEqual(grade('先用表格。',{startsWith:'💡 Zero · 方案讨论'}).failures,['开头应为「💡 Zero · 方案讨论」'])
 assert.match(grade('💡 Zero · 方案讨论\n💡 Zero · 方案讨论',{startsWith:'💡 Zero · 方案讨论'}).failures.join(),/重复/)
 assert.match(grade('❓ Zero · 想问你\n离线吗？同步吗？',{questionCount:1}).failures.join(),/实际 2 个/)
 assert.match(grade('abc',{maxUtf16:2}).failures.join(),/超过/)
 assert.match(grade('📦 Zero · 交付',{notContains:['📦 Zero · 交付']}).failures.join(),/不应包含/)
})

test('offline skill eval reads saved answers and reports pass or failure without a model call',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zerolink-eval-test-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const responses=join(dir,'responses.json')
 const run=()=>promisify(execFile)(process.execPath,['src/tools/eval-agent-skills.mjs','--case','discussion-advice','--responses',responses],{cwd:new URL('../../..',import.meta.url)})
 await writeFile(responses,JSON.stringify({'discussion-advice':['💡 Zero · 方案讨论\n先用表格。']}))
 assert.match((await run()).stdout,/PASS discussion-advice/)
 await writeFile(responses,JSON.stringify({'discussion-advice':['先用表格。']}))
 await assert.rejects(run(),error=>error.code===1&&/FAIL discussion-advice/.test(error.stdout))
})
