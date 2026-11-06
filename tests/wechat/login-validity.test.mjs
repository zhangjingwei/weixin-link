import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {trackLoginValidity} from '../../src/wechat/login-validity.mjs'
test('session expiry clears login validity while the SDK remains running',()=>{
 const bot=new EventEmitter();bot.isRunning=true
 const state=trackLoginValidity(bot)
 assert.equal(state.valid,false)
 bot.emit('login');assert.equal(state.valid,true)
 bot.emit('session:expired');assert.equal(state.valid,false);assert.equal(bot.isRunning,true)
 // A failed relogin must not silently restore readiness.
 bot.on('error',()=>{});bot.emit('error',Error('login failed'));assert.equal(state.valid,false)
 bot.emit('session:restored');assert.equal(state.valid,true)
})
