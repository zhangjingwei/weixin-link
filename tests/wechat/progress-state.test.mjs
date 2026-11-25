import test from 'node:test'
import assert from 'node:assert/strict'
import {heartbeatDue,taskProgress} from '../../src/domain/tasks/progress-state.mjs'
test('heartbeat silence is three minutes then five; only normal progress restarts silence',()=>{
 const s={busy:true,state:'running',progressStartedAt:1000,lastUserNoticeAt:1000}
 assert.equal(heartbeatDue(s,180999),false);assert.equal(heartbeatDue(s,181000),true)
 s.lastWaitNoticeAt=181000
 assert.equal(heartbeatDue(s,361000),false);assert.equal(heartbeatDue(s,481000),true)
 s.lastUserNoticeAt=450000
 assert.equal(heartbeatDue(s,629999),false);assert.equal(heartbeatDue(s,630000),true)
 for(const extra of [{finalReceived:true},{busy:false},{state:'stopping'},{waitingAttachment:true},{nativeActiveFlags:['waitingOnUserInput']},{exiting:true},{workToken:{current:()=>false}}])assert.equal(heartbeatDue({...s,...extra},1000000),false)
})
test('stage requires fresh execution evidence, never just a live service',()=>{
 const s={busy:true,state:'running',executionEvidenceAt:1000,progressStartedAt:1000}
 assert.equal(taskProgress(s,91000).phase,'running');assert.equal(taskProgress(s,91001).phase,'unknown')
 assert.equal(taskProgress({...s,nativeStatus:'active',executionEvidenceAt:null},1000).phase,'unknown')
 assert.equal(taskProgress({...s,nativeActiveFlags:['waitingOnApproval']},1000).phase,'waiting')
 assert.equal(taskProgress({...s,finalReceived:true},1000).phase,'delivering')
 assert.equal(taskProgress({...s,busy:false,state:'idle'},1000).phase,'idle')
})
