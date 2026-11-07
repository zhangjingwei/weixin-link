import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,realpath,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {downloadMedia} from '../../src/media/media-input.mjs'
import {OutputStore,OutputTransport} from '../../src/media/outbound-media.mjs'

test('media download rejects untrusted targets before fetch and disables redirects',async()=>{
 for(const full_url of ['https://127.0.0.1/a','https://[::1]/a','https://10.0.0.1/a','https://example.com/a','http://novac2c.cdn.weixin.qq.com/a','https://novac2c.cdn.weixin.qq.com.evil.test/a','https://user:pass@novac2c.cdn.weixin.qq.com/a','https://novac2c.cdn.weixin.qq.com:8443/a']){
  let called=false
  await assert.rejects(downloadMedia({media:{full_url}},async()=>{called=true}),/可信 CDN/)
  assert.equal(called,false)
 }
 let options
 await assert.rejects(downloadMedia({media:{encrypt_query_param:'fixture'}},async(url,opts)=>{assert.equal(new URL(url).hostname,'novac2c.cdn.weixin.qq.com');options=opts;throw Error('redirect blocked')}),/redirect blocked/)
 assert.equal(options.redirect,'error')
})

test('stopping during text retry prevents a new submission',async()=>{
 let current=true,calls=0
 const transport=new OutputTransport({store:{},retryDelayMs:5,send:async()=>{calls++;current=false;throw Object.assign(Error('rejected'),{deliveryState:'failed'})}})
 assert.deepEqual(await transport.deliver('owner','text',{current:()=>current}),{status:'cancelled'})
 assert.equal(calls,1)
})

test('stopping during media retry checkpoints cancellation and suppresses remaining media',async()=>{
 let current=true,calls=0,checkpoints=0
 const transport=new OutputTransport({store:{bytes:async()=>Buffer.from('fixture')},retryDelayMs:5,send:async()=>{calls++;current=false;throw Object.assign(Error('rejected'),{deliveryState:'failed'})}})
 const packet={text:'',textParts:[],attachments:[{status:'pending',kind:'file'},{status:'pending',kind:'file'}]}
 assert.equal((await transport.deliver('owner',packet,{current:()=>current,checkpoint:async()=>{checkpoints++}})).status,'cancelled')
 assert.equal(calls,1)
 assert.deepEqual(packet.attachments.map(x=>x.status),['cancelled','cancelled'])
 assert.ok(checkpoints>=2)
})

test('canonical workspace aliases work without permitting child symlinks or escapes',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'export-security-'))
 t.after(()=>rm(temp,{recursive:true,force:true}))
 const root=await realpath(temp),actual=join(root,'actual'),alias=join(root,'alias')
 await mkdir(actual);await symlink(actual,alias,process.platform==='win32'?'junction':'dir')
 await writeFile(join(actual,'file.txt'),'fixture')
 await writeFile(join(root,'outside.txt'),'private fixture')
 await symlink(root,join(actual,'escape'),process.platform==='win32'?'junction':'dir')
 const store=new OutputStore({cwd:alias,roots:[alias],stateDir:join(root,'state')})
 for(const file of [join(alias,'file.txt'),join(actual,'file.txt')]){
  const packet=await store.package('owner',`[file](${file})`)
  assert.equal(packet.attachments.length,1)
 }
 for(const file of [join(alias,'escape','outside.txt'),join(root,'outside.txt')]){
  const packet=await store.package('owner',`[file](${file})`)
  assert.equal(packet.attachments.length,0)
  assert.equal(packet.errors[0].code,'EXPORT_PATH_REFUSED')
 }
})
