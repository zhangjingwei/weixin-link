import test from 'node:test'
import assert from 'node:assert/strict'
import {receiptPolicy,emptyContinuationNotice} from '../../src/core/notification-policy.mjs'
test('receipt waits for known association without merging distinct tasks',()=>{
 assert.equal(receiptPolicy({media:true,busy:true}),'defer')
 assert.equal(receiptPolicy({media:true,waiting:true}),'suppress')
 assert.equal(receiptPolicy({media:true,busy:false}),'send')
 assert.equal(receiptPolicy({media:false,busy:true}),'send')
})
test('only empty attachment-start notices are filtered, meaningful results and errors remain',()=>{
 for(const s of ['我会读取压缩包中的聊天记录，按上一条要求汇总。','我先解压读取。'])assert.equal(emptyContinuationNotice(s),true)
 for(const s of ['已读取13条消息。','解压失败，需要密码。','我发现文件无法读取。','需要你确认处理哪一个？','已完成总结。','我先读取文件，结果显示内容为空。','我会核对总结，但这里存在冲突。','正在处理附件，部分记录缺失。'])assert.equal(emptyContinuationNotice(s),false)
})
