import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {UpdateNotifier} from '../../../src/application/notifications/update-notifier.mjs'
import {createUpdateNoticeStateStore} from '../../../src/infrastructure/storage/update-notice-state.mjs'
import {readInstalledRelease} from '../../../src/infrastructure/updates/release-source.mjs'

const old='a'.repeat(40),latest='b'.repeat(40)
async function fixture(t,{ref='v1.0.0',commit=old}={}){
 const root=await mkdtemp(join(tmpdir(),'update-notice-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 await writeFile(join(root,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref,commit:commit.slice(0,7)}))
 const sent=[]
 const options={stateStore:createUpdateNoticeStateStore(root),readInstalled:()=>readInstalledRelease(root),owners:['owner'],fetchLatest:async()=>({tag:'v1.1.0',commit:latest}),send:async(owner,text)=>{sent.push({owner,text});return {status:'accepted'}}}
 return {root,sent,options}
}
const noticePath=f=>f.options.stateStore.path('owner')

test('only a newer stable release prompts once, including after restart',async t=>{
 const f=await fixture(t)
 const notifier=new UpdateNotifier(f.options)
 await notifier.tick();await notifier.tick()
 await new UpdateNotifier(f.options).tick()
 assert.equal(f.sent.length,1)
 assert.match(f.sent[0].text,/回复“升级”/)
 assert.match(f.sent[0].text,/不会自动升级/)
 assert.equal(JSON.parse(await readFile(noticePath(f),'utf8')).status,'accepted')
})

test('matching version, custom ref and unavailable release marker do not prompt',async t=>{
 const f=await fixture(t)
 await new UpdateNotifier({...f.options,fetchLatest:async()=>({tag:'v1.0.0',commit:old})}).tick()
 await writeFile(join(f.root,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'feature/x',commit:old.slice(0,7)}))
 await new UpdateNotifier(f.options).tick()
 await rm(join(f.root,'.weixin-link-release.json'))
 await new UpdateNotifier(f.options).tick()
 assert.equal(f.sent.length,0)
})

test('uncertain delivery is never replayed; confirmed cancellation can retry',async t=>{
 const f=await fixture(t)
 const unknown=new UpdateNotifier({...f.options,send:async()=>{f.sent.push('attempt');throw Error('timeout')}})
 await unknown.tick();await new UpdateNotifier(f.options).tick()
 assert.equal(f.sent.length,1)
 assert.equal(JSON.parse(await readFile(noticePath(f),'utf8')).status,'unknown')
 const g=await fixture(t)
 const cancelled=new UpdateNotifier({...g.options,send:async()=>({status:'cancelled'})})
 await cancelled.tick();await new UpdateNotifier(g.options).tick()
 assert.equal(g.sent.length,1)
})

test('confirmed WeChat rejection retries on a later check without replaying uncertain delivery',async t=>{
 const f=await fixture(t)
 const rejected=new UpdateNotifier({...f.options,send:async()=>{f.sent.push('rejected');throw Object.assign(Error('rejected'),{name:'ApiError',errcode:-2,payload:{ret:-2}})}})
 await rejected.tick()
 assert.equal(JSON.parse(await readFile(noticePath(f),'utf8')).status,'deferred')
 await new UpdateNotifier(f.options).tick()
 assert.equal(f.sent.length,2)
 assert.equal(JSON.parse(await readFile(noticePath(f),'utf8')).status,'accepted')
 await new UpdateNotifier(f.options).tick()
 assert.equal(f.sent.length,2)
})

test('network failure and corrupt state do not send or overwrite the state',async t=>{
 const f=await fixture(t)
 const events=[]
 await new UpdateNotifier({...f.options,fetchLatest:async()=>{throw Error('offline')},log:event=>events.push(event)}).tick()
 assert.equal(f.sent.length,0)
 const notifier=new UpdateNotifier({...f.options,log:event=>events.push(event)})
 await writeFile(noticePath(f),'invalid')
 await notifier.tick()
 assert.equal(f.sent.length,0)
 assert.equal(await readFile(noticePath(f),'utf8'),'invalid')
 assert.ok(events.includes('update_notice.check_failed'))
 assert.ok(events.includes('update_notice.state_invalid'))
})

test('new release notification includes publisher highlights and a pinned release link',async t=>{
 const f=await fixture(t)
 await new UpdateNotifier({...f.options,fetchLatest:async()=>({tag:'v1.1.0',commit:latest,notes:'- Preserve complete messages\n- Add explicit update checks'})}).tick()
 assert.match(f.sent[0].text,/Preserve complete messages/)
 assert.match(f.sent[0].text,/releases\/tag\/v1.1.0/)
 await new UpdateNotifier(f.options).tick();assert.equal(f.sent.length,1)
})
