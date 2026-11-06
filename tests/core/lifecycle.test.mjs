import test from 'node:test'
import assert from 'node:assert/strict'
import {CancellationScopes,transition} from '../../src/core/lifecycle.mjs'
test('shared cancellation invalidates all old stages but isolates owners and new work',()=>{
 const scopes=new CancellationScopes(),a=scopes.capture('a'),other=scopes.capture('b');let notified=0;scopes.onCancel(()=>notified++)
 scopes.cancel('a');assert.equal(a.current(),false);assert.equal(a.signal.aborted,true);assert.equal(other.current(),true);assert.equal(scopes.capture('a').current(),true);assert.equal(notified,1)
})
test('canonical state projects mutually consistent flags and closed sessions cannot revive',()=>{
 const s={};for(const phase of ['connecting','idle','running','stopping','delivering','closed']){
 transition(s,phase);assert.equal(s.state,phase);assert.ok([s.connecting,s.busy,s.finishing,s.exited].filter(Boolean).length<=1)
 }assert.equal(transition(s,'running'),false);assert.equal(s.state,'closed');assert.throws(()=>transition(s,'invented'))
})
