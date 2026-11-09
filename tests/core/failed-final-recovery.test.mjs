import test from 'node:test'
import assert from 'node:assert/strict'
import {recoverFailedFinal} from '../../src/application/notifications/failed-final-recovery.mjs'
import {confirmedFinalRejection} from '../../src/infrastructure/wechat/delivery-evidence.mjs'
import {deliveryError} from '../../src/core/delivery/delivery-error.mjs'
import {safeRecord} from '../../src/core/diagnostics/diagnostic-log.mjs'

const fixture=()=>{
 const record={lastReply:'最终结果\n\n✅ 本轮回答结束。',recovery:{execution:'completed',delivery:'failed',delivery_error:{api_code:-2}}}
 const saves=[],manager={state:{users:{owner:record,other:{lastReply:'私有结果'}}},sessions:new Map(),save:async()=>{saves.push(structuredClone(record.recovery))}}
 return {record,saves,manager}
}
const recover=(manager,key,deliver)=>recoverFailedFinal(manager,key,deliver,confirmedFinalRejection)
test('a fresh inbound can resend a rejected final once with a durable checkpoint',async()=>{
 const {record,saves,manager}=fixture(),sent=[]
 const result=await recover(manager,'owner',async(key,text)=>{assert.equal(saves[0].autoResend,'sending');sent.push([key,text]);return {status:'accepted'}})
 assert.equal(result,'accepted');assert.equal(record.recovery.delivery,'accepted');assert.equal(record.recovery.autoResend,'attempted')
 assert.equal(sent.length,1);assert.match(sent[0][1],/上次回答补发/);assert.equal(sent[0][1].includes('私有结果'),false)
 assert.equal(await recover(manager,'owner',async()=>{throw Error('must not resend')}),null)
})
test('a second rejection is recorded without looping on later messages',async()=>{
 const {record,manager}=fixture();let attempts=0
 const rejection=Object.assign(Error('rejected'),{name:'ApiError',code:'API_ERROR',httpStatus:200,errcode:-2})
 assert.equal(await recover(manager,'owner',async()=>{attempts++;throw rejection}),'failed')
 assert.equal(record.recovery.autoResend,'attempted');assert.equal(record.recovery.delivery,'failed')
 assert.equal(await recover(manager,'owner',async()=>{attempts++}),null);assert.equal(attempts,1)
})
test('ambiguous resend remains unknown and is never sent again automatically',async()=>{
 const {record,manager}=fixture()
 assert.equal(await recover(manager,'owner',async()=>{throw Error('connection lost')}),'unknown')
 assert.equal(record.recovery.delivery,'unknown');assert.equal(record.recovery.autoResend,'attempted')
})
test('unknown delivery, bundled output and busy sessions never auto resend',async()=>{
 const {record,manager}=fixture();record.recovery.delivery='unknown';assert.equal(await recover(manager,'owner',async()=>{throw Error()}),null)
 record.recovery.delivery='failed';record.lastOutput={attachments:[]};assert.equal(await recover(manager,'owner',async()=>{throw Error()}),null)
 delete record.lastOutput;manager.sessions.set('owner',{busy:true});assert.equal(await recover(manager,'owner',async()=>{throw Error()}),null)
})
test('diagnostics classify known API reasons without recording the raw server message',()=>{
 const error={name:'ApiError',code:'API_ERROR',errcode:-2,payload:{errmsg:'prepare failed',token:'private'}}
 const detail=deliveryError(error),record=safeRecord('delivery.failed',detail)
 assert.equal(detail.api_reason,'prepare_failed');assert.equal(record.api_reason,'prepare_failed')
 assert(!JSON.stringify(record).includes('private'))
 assert.equal(deliveryError({...error,payload:{errmsg:'private-token'}}).api_reason,undefined)
})
