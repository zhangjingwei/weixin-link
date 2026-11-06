import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {diagnosticCommand,handleDiagnostic} from '../../src/core/diagnostic-commands.mjs'
test('exact commands only',()=>{assert.equal(diagnosticCommand(' 运行诊断 '),'diagnose');assert.equal(diagnosticCommand('请解释运行诊断'),null)})
test('account scoped report excludes raw secret fields and handles malformed records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostic-'));try{
 await mkdir(join(dir,'logs'));await writeFile(join(dir,'logs/events.jsonl'),JSON.stringify({timestamp:'2026-11-06T01:00:00.000Z',event:'turn.started',trace_id:'secret-token',level:'error',message:'secret-token',token:'secret-token',code:'secret-token'})+'\nbad\nnull\n')
 const sent=[];await handleDiagnostic('export',x=>sent.push(x),{stateDir:dir,outputDir:join(dir,'outputs'),services:{status:async()=>({active:true,pid:123})}})
 const path=sent[0].match(/\]\(<(.+)>\)/)[1],report=await readFile(path,'utf8');assert.ok(!report.includes('secret-token'));const data=JSON.parse(report);assert.equal(data.records,1);assert.equal(data.invalid_lines,2);assert.equal(data.unmatched_turn_count,1);assert.equal(data.service.active,true)
 const missing=[];await handleDiagnostic('errors',x=>missing.push(x),{stateDir:join(dir,'other')});assert.match(missing[0],/暂无诊断日志/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
