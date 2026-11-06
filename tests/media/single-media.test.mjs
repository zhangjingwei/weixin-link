import test from 'node:test'
import assert from 'node:assert/strict'
import {singleMedia} from '../../src/media/single-media.mjs'
test('individual messages submit immediately and never collect later text',async()=>{
 const out=[],token={current:()=>true},deps={prepare:async()=>({attachments:[{path:'/tmp/image'}],errors:[]}),compose:async x=>x,submit:async(...a)=>out.push(a)}
 await singleMedia({userId:'a',_ingressId:'one',raw:{item_list:[{text_item:{text:'说明'}},{image_item:{}}]}},token,deps)
 await singleMedia({userId:'a',_ingressId:'two',raw:{item_list:[{image_item:{}}]}},token,deps)
 assert.equal(out.length,2);assert.equal(out[0][1].text,'说明');assert.equal(out[1][1].text,'');assert.equal(out[0][3],'one');assert.equal(out[1][3],'two')
})
test('stop during download prevents submission; failed download does not submit empty media',async()=>{
 let active=true,submitted=false
 const token={current:()=>active},deps={prepare:async()=>{active=false;return {attachments:[{}],errors:[]}},compose:async()=>({}),submit:async()=>{submitted=true}}
 assert.equal(await singleMedia({},token,deps),false);assert.equal(submitted,false)
 active=true;deps.prepare=async()=>({attachments:[],errors:['failed']});await assert.rejects(()=>singleMedia({},token,deps));assert.equal(submitted,false)
})
