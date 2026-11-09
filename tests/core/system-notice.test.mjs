import test from 'node:test'
import assert from 'node:assert/strict'
import {systemNotice} from '../../src/interfaces/views/system-notice.mjs'

test('program notices add one label in the same text or attachment packet',()=>{
 assert.equal(systemNotice('服务已连接。'),'服务已连接。\n〔系统通知〕')
 assert.equal(systemNotice(systemNotice('服务已连接。')),'服务已连接。\n〔系统通知〕')
 const packet={text:'诊断完成。',attachments:[{path:'/tmp/report.json'}]}
 assert.deepEqual(systemNotice(packet),{...packet,text:'诊断完成。\n〔系统通知〕'})
 assert.equal(packet.text,'诊断完成。')
})
