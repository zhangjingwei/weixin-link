import test from 'node:test'
import assert from 'node:assert/strict'
import {traceIngress} from './ingress-trace.mjs'
import {safeRecord} from './diagnostic-log.mjs'
test('wire, parse, callback boundaries correlate without payload secrets or message splitting',async()=>{
 const records=[],wire={message_id:123,seq:7,create_time_ms:1000,context_token:'SECRET',item_list:[{type:1,text_item:{text:'PRIVATE'}},{type:2,image_item:{url:'https://secret'}}]}
 const bot={api:{async getUpdates(){return {msgs:[wire]}}},http:{async executeRequest(){return {data:{msgs:[wire]}}}},parser:{parse:w=>({raw:w})}}
 const trace=traceIngress(bot,(event,data)=>records.push(safeRecord(event,data)))
 try{
 const r=await bot.api.getUpdates();assert.equal(r.msgs[0],wire)
 const m=bot.parser.parse(wire);trace.callback(m)
 await bot.http.executeRequest({url:'https://example.com/ilink/bot/getupdates'})
 const received=records.find(x=>x.event==='ingress.wire_received'),cb=records.find(x=>x.event==='ingress.sdk_callback')
 assert.equal(received.trace_id,cb.trace_id);assert.equal(received.message_ref,cb.message_ref);assert.equal(received.parts,2);assert.equal(received.kind,'1-2')
 assert.ok(!JSON.stringify(records).includes('SECRET'));assert.ok(!JSON.stringify(records).includes('PRIVATE'));assert.ok(!JSON.stringify(records).includes('https://'))
 }finally{trace.close()}
})
