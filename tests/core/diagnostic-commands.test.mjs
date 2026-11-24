import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {handleDiagnostic,readDiagnostics} from '../../src/application/diagnostics/diagnostic-commands.mjs'
import {createManagementMaintenanceController} from '../../src/interfaces/controllers/management-maintenance-controller.mjs'
test('account scoped report excludes raw secret fields and handles malformed records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostic-'));try{
 await mkdir(join(dir,'logs'));await writeFile(join(dir,'logs/events.jsonl'),JSON.stringify({timestamp:'2026-11-06T01:00:00.000Z',event:'turn.started',trace_id:'secret-token',level:'error',message:'secret-token',token:'secret-token',code:'secret-token'})+'\nbad\nnull\n')
 const sent=[];await handleDiagnostic('export',x=>sent.push(x),{stateDir:dir,outputDir:join(dir,'outputs'),services:{status:async()=>({active:true,pid:123})}})
 const path=sent[0].match(/\]\(<(.+)>\)/)[1],report=await readFile(path,'utf8');assert.ok(!report.includes('secret-token'));const data=JSON.parse(report);assert.equal(data.records,1);assert.equal(data.invalid_lines,2);assert.equal(data.unmatched_turn_count,1);assert.equal(data.service.active,true)
 const missing=[];await handleDiagnostic('errors',x=>missing.push(x),{stateDir:join(dir,'other')});assert.match(missing[0],/暂无诊断日志/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('recent errors expose a safe reference shared across failure stages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostic-trace-'));try{
  await mkdir(join(dir,'logs'))
  await writeFile(join(dir,'logs/events.jsonl'),['ingress.persist_failed','outbound.text_failed'].map(event=>JSON.stringify({timestamp:'2026-11-06T01:00:00.000Z',event,trace_id:'same-message-trace',level:'error'})).join('\n')+'\n')
  const sent=[];await handleDiagnostic('errors',value=>sent.push(value),{stateDir:dir})
  const refs=[...sent[0].matchAll(/trace_ref=([a-f0-9]{12})/g)].map(m=>m[1])
  assert.equal(refs.length,2);assert.equal(refs[0],refs[1]);assert.match(sent[0],/ingress.persist_failed/);assert.match(sent[0],/outbound.text_failed/);assert.doesNotMatch(sent[0],/same-message-trace/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('send diagnostics group retry attempts per message and match MCP and export',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostic-sends-'))
 try{
  const logs=join(dir,'logs');await mkdir(logs)
  const row=(timestamp,event,fields={})=>JSON.stringify({timestamp,event,level:'error',trace_id:'private-trace',message:'private body',token:'private-token',url:'https://private.invalid',...fields})
  await writeFile(join(logs,'events.jsonl.1'),row('2026-11-24T01:00:00.000Z','outbound.text_failed',{attempt:1,final_attempt:false,part:1,parts:1,http_status:200,api_code:-2,api_reason:'prepare_failed',delivery_state:'failed',error_kind:'wechat_api'})+'\n')
  await writeFile(join(logs,'events.jsonl'),[
   row('2026-11-24T01:00:01.000Z','outbound.text_failed',{attempt:2,final_attempt:true,part:1,parts:1,http_status:200,api_code:-2,api_reason:'prepare_failed',delivery_state:'failed',error_kind:'wechat_api'}),
   row('2026-11-24T01:00:01.001Z','delivery.failed',{delivery_state:'failed',api_code:-2,api_reason:'prepare_failed'}),
   row('2026-11-24T01:00:02.000Z','outbound.text_failed',{attempt:1,final_attempt:true,part:1,parts:1,http_status:200,api_code:-2,api_reason:'https://private.invalid',delivery_state:'failed'}),
   row('2026-11-24T01:00:02.001Z','delivery.failed',{delivery_state:'failed'}),
   row('2026-11-24T01:00:03.000Z','rpc.failed',{code:'ETIMEDOUT'}),
   row('2026-11-24T01:00:20.000Z','delivery.failed',{delivery_state:'unknown',error_kind:'wechat_transport'}),
  ].join('\n')+'\n')
  const data=await readDiagnostics(logs)
  assert.equal(data.recent_failures.length,4)
  assert.deepEqual(data.recent_failures.map(f=>f.attempts_observed),[2,1,undefined,undefined])
  assert.equal(data.recent_failures[0].api_reason,'prepare_failed')
  assert.equal(data.recent_failures[0].api_code,-2)
  assert.equal(data.recent_failures[0].delivery_state,'failed')
  assert.equal(data.recent_failures[1].api_reason,undefined)
  assert.equal(data.recent_failures[2].code,'ETIMEDOUT')
  assert.equal(data.recent_failures[3].delivery_state,'unknown')
  const port=createManagementMaintenanceController({account:{stateDir:dir}})
  assert.deepEqual((await port.diagnostics()).recent_failures,data.recent_failures)
  const sent=[];await handleDiagnostic('errors',text=>sent.push(text),{stateDir:dir})
  assert.match(sent[0],/文本发送.*HTTP 200 微信返回码 -2（消息准备失败） 投递：失败 尝试记录：2 次/)
  assert.match(sent[0],/rpc.failed ETIMEDOUT/)
  assert.match(sent[0],/delivery.failed（投递）（微信连接异常） 投递：结果待确认/)
  await handleDiagnostic('export',text=>sent.push(text),{stateDir:dir,outputDir:join(dir,'outputs')})
  const path=sent[1].match(/\]\(<(.+)>\)/)[1]
  const exported=JSON.parse(await readFile(path,'utf8'))
  assert.deepEqual(exported.recent_failures,data.recent_failures)
  for(const visible of [JSON.stringify(data),sent.join('\n'),JSON.stringify(exported)])for(const secret of ['private body','private-token','https://private.invalid','private-trace'])assert(!visible.includes(secret))
 }finally{await rm(dir,{recursive:true,force:true})}
})
