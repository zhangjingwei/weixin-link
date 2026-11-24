import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {selectTerminalModel} from '../../src/setup/terminal-model-selection.mjs'

async function fixture(t,{empty=false,unconfirmed=false}={}){
 const home=await mkdtemp(join(tmpdir(),'model-selection-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const calls=[];let saved='model-terra',closed=false
 return {home,calls,get closed(){return closed},rpcFactory:()=>({
  write:()=>{},close:()=>{closed=true},request:async(method,params)=>{
   calls.push({method,params})
   if(method==='initialize')return {}
   if(method==='model/list')return {data:empty?[]:Array.from({length:12},(_,i)=>({model:i===0?'model-terra':`model-sol-${i}`,displayName:i===0?'Terra':`Sol ${i}`,isDefault:i===0})),nextCursor:null}
   if(method==='config/read')return {config:{model:unconfirmed?'model-terra':saved}}
   if(method==='config/value/write'){saved=params.value;return {}}
   throw Error('unexpected request')
  }
 })}
}

test('selects a live model including entries after nine and verifies native persistence',async t=>{
 const f=await fixture(t),messages=[]
 const result=await selectTerminalModel({...f,choose:async prompt=>{assert(prompt.includes('[当前]'));assert(prompt.includes('12. Sol 11'));assert(prompt.includes('桌面端和命令行'));return '12'},write:text=>messages.push(text)})
 assert.equal(result,'model-sol-11')
 assert.deepEqual(f.calls.find(c=>c.method==='config/value/write').params,{keyPath:'model',value:'model-sol-11',mergeStrategy:'replace'})
 assert.equal(f.closed,true);assert(messages[0].includes('model-sol-11'))
})

test('deferral leaves native configuration unchanged',async t=>{
 const f=await fixture(t)
 assert.equal(await selectTerminalModel({...f,choose:async()=>'0',write:()=>{}}),null)
 assert(!f.calls.some(c=>c.method==='config/value/write'));assert(f.closed)
})

test('empty list and unconfirmed save fail without success output',async t=>{
 for(const options of [{empty:true},{unconfirmed:true}]){
  const f=await fixture(t,options)
  await assert.rejects(selectTerminalModel({...f,choose:async()=>'2',write:()=>assert.fail('false success')}),/MODEL_LIST_EMPTY|MODEL_SELECTION_UNCONFIRMED/)
  assert(f.closed)
 }
})
