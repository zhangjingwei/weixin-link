import test from 'node:test'
import assert from 'node:assert/strict'
import {TypingStatus,typingOwners} from './typing-status.mjs'
const flush=()=>new Promise(r=>setImmediate(r))
test('typing starts, refreshes with bound, stops once and isolates accounts/users',async()=>{
 let now=0;const calls=[],t=new TypingStatus({start:async u=>calls.push('start:'+u),stop:async u=>calls.push('stop:'+u),now:()=>now})
 t.sync(new Set(['a','b']));await flush();t.sync(new Set(['a','b']));await flush();assert.equal(calls.length,2)
 now=8001;t.sync(new Set(['a']));await flush();assert.deepEqual(calls,['start:a','start:b','start:a','stop:b'])
 t.sync(new Set());await flush();t.sync(new Set());await flush();assert.equal(calls.filter(x=>x==='stop:a').length,1);assert.equal(t.users.size,0)
})
test('late start is followed by stop; errors do not leak or block cancellation',async()=>{
 let release;const calls=[],t=new TypingStatus({start:()=>{calls.push('start');return new Promise(r=>release=r)},stop:async()=>calls.push('stop')})
 t.sync(new Set(['a']));await flush();t.sync(new Set());release();await flush();assert.deepEqual(calls,['start','stop'])
 const failed=new TypingStatus({start:async()=>{throw Error('secret')},stop:async()=>calls.push('cleanup')});failed.sync(new Set(['a']));await flush();failed.close();await flush();assert.ok(calls.includes('cleanup'))
})
test('awaiting user questions, cancellation and idle states do not show typing',()=>{
 const a={userId:'a',state:'running',busy:true,workToken:{current:()=>true}},b={userId:'b',state:'idle'},c={userId:'c',state:'running',busy:true,workToken:{current:()=>false}}
 const manager={sessions:new Map([['a',a],['b',b],['c',c]]),questions:new Map()}
 assert.deepEqual([...typingOwners(manager)],['a']);manager.questions.set('q',{session:a});assert.equal(typingOwners(manager).size,0)
 manager.questions.clear();a.state='stopping';assert.equal(typingOwners(manager).size,0)
})
