import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDiagnosticLog,safeRecord,errorFields,createSdkLogger} from './diagnostic-log.mjs'

test('diagnostic logs exclude bodies, secrets, raw exceptions, URLs and identifiable account IDs',()=>{
 const record=safeRecord('message.received',{userId:'real-wechat-user',messageId:'real-message-id',trace_id:'trace-1',chars:42,text:'secret password',body:'private conversation',token:'sk-secret',url:'https://private/?token=secret',...errorFields(new Error('password=secret'))})
 assert.equal(record.chars,42);assert.equal(record.error_type,'Error');assert.ok(record.user_ref);assert.ok(record.message_ref)
 const encoded=JSON.stringify(record);for(const secret of ['real-wechat-user','real-message-id','password','sk-secret','private','https:'])assert.ok(!encoded.includes(secret))
 assert.equal(safeRecord('rpc.timeout').level,'error');assert.throws(()=>safeRecord('invalid event payload'))
})
test('JSONL is valid, ordered, permission-restricted and bounded through rotation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wechat-log-'))
 try{const log=createDiagnosticLog({dir,maxBytes:500,backups:2});await Promise.all(Array.from({length:20},(_,count)=>log.log('test.event',{count,trace_id:'test'})));await log.flush();const files=await readdir(dir);assert.ok(files.includes('events.jsonl'));assert.equal(files.length,3);let previous=-1;for(const file of ['events.jsonl.2','events.jsonl.1','events.jsonl']){const stats=await stat(join(dir,file));assert.equal(stats.mode&0o777,0o600);assert.ok(stats.size<=500);for(const line of (await readFile(join(dir,file),'utf8')).trim().split('\n')){const r=JSON.parse(line);assert.ok(r.count>previous);previous=r.count}}assert.equal(previous,19);assert.equal((await stat(dir)).mode&0o777,0o700)}finally{await rm(dir,{recursive:true,force:true})}
})
test('log backlog is bounded and dropped entries are observable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wechat-log-'))
 try{const log=createDiagnosticLog({dir,maxPending:1});const first=log.log('test.first');assert.equal(await log.log('test.dropped'),false);await first;await log.log('test.recovered');const records=(await readFile(join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(records.reduce((n,r)=>n+(r.dropped??0),0),1);assert.equal(log.stats().pending,0)}finally{await rm(dir,{recursive:true,force:true})}
})

test('SDK free-text errors cannot leak request URLs or tokens into diagnostics',()=>{const events=[],sdk=createSdkLogger((event,fields)=>events.push({event,...fields}));sdk.child('private-context').error('Poll error: https://private/?token=secret-token');sdk.warn('unknown password=secret-token');assert.equal(events[0].reason,'poll');assert.equal(events[1].reason,'unspecified');assert.ok(!JSON.stringify(events).includes('secret-token'));assert.ok(!JSON.stringify(events).includes('private-context'))})

test('structured API failures retain safe routing fields but never response payloads or messages',()=>{
 const error=Object.assign(new Error('private response token=secret'),{name:'ApiError',code:'API_ERROR',httpStatus:409,errcode:19001,payload:{token:'secret-token',body:'private answer'}})
 const record=safeRecord('outbound.text_failed',{trace_id:'trace',attempt:2,http_status:error.httpStatus,api_code:error.errcode,...errorFields(error),delivery_state:'failed',final_attempt:true})
 assert.equal(record.error_type,'ApiError');assert.equal(record.error_kind,'wechat_api');assert.equal(record.error_code,'API_ERROR');assert.equal(record.http_status,409);assert.equal(record.api_code,19001);assert.equal(record.delivery_state,'failed');assert.equal(record.final_attempt,true)
 const encoded=JSON.stringify(record);for(const secret of ['private response','secret-token','private answer'])assert.ok(!encoded.includes(secret))
})
