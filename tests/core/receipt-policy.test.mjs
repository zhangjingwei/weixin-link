import test from 'node:test'
import assert from 'node:assert/strict'
import {receiptPolicy} from '../../src/domain/delivery/receipt-policy.mjs'
test('receipt waits for known association without merging distinct tasks',()=>{
 assert.equal(receiptPolicy({media:true,busy:true}),'defer')
 assert.equal(receiptPolicy({media:true,waiting:true}),'suppress')
 assert.equal(receiptPolicy({media:true,busy:false}),'suppress')
 assert.equal(receiptPolicy({media:false,busy:true}),'suppress')
})
