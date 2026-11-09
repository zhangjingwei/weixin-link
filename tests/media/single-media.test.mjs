import test from 'node:test'
import assert from 'node:assert/strict'
import {singleMedia} from '../../src/application/intake/single-media.mjs'
import {mediaMessageContext} from '../../src/interfaces/wechat/voice-text.mjs'
test('individual messages submit immediately and never collect later text',async()=>{
 const out=[],token={current:()=>true},deps={prepare:async()=>({attachments:[{path:'/tmp/image'}],errors:[]}),compose:async x=>x,submit:async(...a)=>out.push(a)}
 await singleMedia({userId:'a',_ingressId:'one',raw:{item_list:[{text_item:{text:'说明'}},{image_item:{}}]}},token,deps,mediaMessageContext)
 await singleMedia({userId:'a',_ingressId:'two',raw:{item_list:[{image_item:{}}]}},token,deps,mediaMessageContext)
 assert.equal(out.length,2);assert.equal(out[0][1].text,'说明');assert.equal(out[1][1].text,'');assert.equal(out[0][3],'one');assert.equal(out[1][3],'two')
})
test('stop during download prevents submission; failed download does not submit empty media',async()=>{
 let active=true,submitted=false
 const token={current:()=>active},deps={prepare:async()=>{active=false;return {attachments:[{}],errors:[]}},compose:async()=>({}),submit:async()=>{submitted=true}}
 assert.equal(await singleMedia({},token,deps,mediaMessageContext),false);assert.equal(submitted,false)
 active=true;deps.prepare=async()=>({attachments:[],errors:['failed']});await assert.rejects(()=>singleMedia({},token,deps,mediaMessageContext));assert.equal(submitted,false)
})
test('application media flow uses the interface-provided text and message identity',async()=>{
 const submitted=[],events=[],token={current:()=>true}
 await singleMedia({userId:'owner',raw:{item_list:[{text_item:{text:'raw text'}}]}},token,{
  prepare:async()=>({attachments:[{}],errors:[]}),compose:async input=>input,
  submit:async(_owner,input)=>submitted.push(input),log:(_event,fields)=>events.push(fields),
 },()=>({instructionText:'normalized text',messageId:'message-1'}))
 assert.equal(submitted[0].text,'normalized text')
 assert.equal(events[0].messageId,'message-1')
})
