import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WeChatBot} from 'wechatbot-zerolink'
import {pairingStorage} from '../../src/infrastructure/wechat/pairing-storage.mjs'

test('pairing sends the saved token and reuses a bound account without changing the disk credential',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'pairing-storage-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const previous={accountId:'saved-bot',userId:'owner',token:'old-token',baseUrl:'https://ilinkai.weixin.qq.com'}
 const file=join(dir,'credentials.json');await writeFile(file,JSON.stringify(previous))
 const bot=new WeChatBot({storage:await pairingStorage(dir),logger:{child(){return this},info(){},warn(){},error(){}}})
 let sent
 bot.api.getQrCode=async(_base,tokens)=>{sent=tokens;return {qrcode:'test-qr',qrcode_img_content:'https://example.test/qr'}}
 bot.api.pollQrStatus=async()=>({status:'binded_redirect'})
 assert.deepEqual(await bot.login({force:true,verifyPin:true}),previous)
 assert.deepEqual(sent,['old-token'])
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),previous)
})

test('new account pairing starts with no saved token',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'pairing-empty-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const storage=await pairingStorage(dir)
 assert.equal(await storage.get('credentials'),undefined)
})

test('malformed saved credential fails before new pairing',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'pairing-malformed-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 await writeFile(join(dir,'credentials.json'),'{bad')
 await assert.rejects(pairingStorage(dir),/CREDENTIALS_UNREADABLE/)
})
