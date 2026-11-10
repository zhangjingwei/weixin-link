import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises'
import {PairingState,pairingStatus,currentLoginLink,readBrowserLoginUrl,QR_FRESHNESS_MS} from '../../src/infrastructure/wechat/pairing-state.mjs'
async function fixture(work){const dir=await mkdtemp('/tmp/login-state-');try{await work(dir,new PairingState(dir))}finally{await rm(dir,{recursive:true,force:true})}}
const account=dir=>({id:'test',stateDir:dir})
test('fresh login returns only a current HTTPS address',()=>fixture(async(dir,state)=>{
 await state.publish('https://weixin.qq.com/x/example')
 const result=await currentLoginLink(account(dir))
 assert.equal(result.url,'https://weixin.qq.com/x/example')
 assert.equal(result.path,undefined)
 assert(result.freshness_seconds<=90)
 assert(!(await readdir(dir)).some(name=>name.endsWith('.png')||name.endsWith('.terminal')))
}))
test('expired or stopped login address cannot be delivered',()=>fixture(async(dir,state)=>{
 await state.publish('https://weixin.qq.com/x/example')
 await assert.rejects(currentLoginLink(account(dir),{now:Date.now()+QR_FRESHNESS_MS}),/TOO_OLD/)
 await assert.rejects(currentLoginLink(account(dir),{running:false}),/REFRESH_REQUIRED/)
 await state.set('qr_expired')
 await assert.rejects(currentLoginLink(account(dir)),/REFRESH_REQUIRED/)
}))
test('a newer login generation replaces the previous address',()=>fixture(async(dir,state)=>{
 const first=state.publish('https://weixin.qq.com/x/old'),expired=state.set('qr_expired')
 await Promise.all([first,expired])
 assert.equal((await pairingStatus(dir)).status,'qr_expired')
 await state.publish('https://weixin.qq.com/x/new')
 assert.equal((await currentLoginLink(account(dir))).url,'https://weixin.qq.com/x/new')
}))
test('missing or unsafe login addresses fail closed',()=>fixture(async(dir,state)=>{
 await assert.rejects(state.publish('javascript:alert(1)'),/INVALID_LOGIN_URL/)
 await writeFile(dir+'/pairing.json',JSON.stringify({status:'waiting_scan'}))
 assert.equal((await pairingStatus(dir)).status,'refresh_required')
 await state.publish('https://weixin.qq.com/x/good')
 const meta=await pairingStatus(dir)
 assert.equal(await readBrowserLoginUrl(dir,meta.qr_version),'https://weixin.qq.com/x/good')
 await writeFile(dir+'/login-'+meta.qr_version+'.url','http://insecure.example')
 await assert.rejects(currentLoginLink(account(dir)),/LOGIN_URL_UNAVAILABLE/)
}))
