import test from 'node:test'
import assert from 'node:assert/strict'
import {MessageDispatch} from '../../src/wechat/message-dispatch.mjs'
test('stop invalidates pending intake without waiting for an earlier slow message',async()=>{const dispatcher=new MessageDispatch(),called=[];let release;const first=dispatcher.enqueue('owner',async current=>{await new Promise(r=>{release=r});if(current())called.push('first')});await new Promise(r=>setImmediate(r));const second=dispatcher.enqueue('owner',async()=>called.push('second'));dispatcher.cancel('owner');release();await Promise.all([first,second]);assert.deepEqual(called,[]);await dispatcher.enqueue('owner',async()=>called.push('new'));assert.deepEqual(called,['new']);assert.equal(dispatcher.users.size,0)})
test('different users and subsequent messages preserve independent ordering',async()=>{const dispatcher=new MessageDispatch(),called=[];await Promise.all([dispatcher.enqueue('a',async()=>called.push('a1')),dispatcher.enqueue('a',async()=>called.push('a2')),dispatcher.enqueue('b',async()=>called.push('b1'))]);assert.ok(called.indexOf('a1')<called.indexOf('a2'));assert.ok(called.includes('b1'))})
test('new intake after stop does not wait for a cancelled slow operation',async()=>{
 const dispatcher=new MessageDispatch();let release,ran=false
 const old=dispatcher.enqueue('owner',async current=>{await new Promise(r=>{release=r});assert.equal(current(),false)})
 await new Promise(r=>setImmediate(r));dispatcher.cancel('owner')
 await dispatcher.enqueue('owner',async()=>{ran=true});assert.equal(ran,true)
 release();await old;assert.equal(dispatcher.users.size,0)
})
