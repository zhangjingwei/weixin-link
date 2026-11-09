import test from 'node:test'
import assert from 'node:assert/strict'
import {ReconnectingConnection} from '../../src/infrastructure/remote/reconnecting-connection.mjs'
test('explicit close during session preparation cannot return a live connection or reconnect',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let created=0
 const connection=new ReconnectingConnection({retryDelays:[1],transportFactory:()=>{created++;return {closed:false,async connect(){},close(){this.closed=true}}},createSession:()=>({}),prepareSession:async()=>{entered();await gate}})
 const pending=connection.connect();await ready;connection.close();release();await assert.rejects(pending,/REMOTE_CLOSED/);assert.equal(created,1);await assert.rejects(connection.connect(),/REMOTE_CLOSED/)
})
