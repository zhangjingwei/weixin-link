import {readWelcomeRequest,recordWelcomeRequest} from '../../src/infrastructure/wechat/welcome-request.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {LifecycleNotice,welcomeMessage,upgradeMessage} from '../../src/wechat/lifecycle-notice.mjs'

const a='a'.repeat(40),b='b'.repeat(40)
async function fixture(t,{welcomePending=false,commit=a}={}){
 const dir=await mkdtemp(join(tmpdir(),'lifecycle-notice-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const sourceDir=join(dir,'source'),stateDir=join(dir,'state');await mkdir(sourceDir);await mkdir(stateDir)
 const release=async commit=>writeFile(join(sourceDir,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit}))
 await release(commit)
 const sent=[],state={result:'accepted'},notice=new LifecycleNotice({stateDir,sourceDir,owners:['owner'],welcomePending,send:async(owner,text)=>{sent.push([owner,text]);if(state.result instanceof Error)throw state.result;return {status:state.result}}})
 const saved=async()=>JSON.parse(await readFile(notice.path('owner'),'utf8'))
 return {notice,state,sent,saved,release}
}
test('fresh pairing is silent across start, inbound and restart, without claiming delivery',async t=>{
 const f=await fixture(t,{welcomePending:true})
 f.notice.welcomeText=async()=>assert.fail('must not compose automatic help')
 await Promise.all([f.notice.start(),f.notice.onInbound('owner')]);await f.notice.start()
 assert.deepEqual(f.sent,[]);assert.equal((await f.saved()).status,'suppressed')
 const next=new LifecycleNotice({stateDir:f.notice.stateDir,sourceDir:f.notice.sourceDir,owners:['owner'],welcomePending:true,send:async()=>assert.fail('no welcome replay')})
 await next.start();await next.onInbound('owner')
})
test('persisted pending welcome is retired without replay or user-text loss',async t=>{
 const f=await fixture(t);await writeFile(f.notice.path('owner'),JSON.stringify({version:1,kind:'welcome',commit:a,status:'deferred'}))
 await f.notice.onInbound('owner');assert.deepEqual(f.sent,[]);assert.equal((await f.saved()).status,'suppressed')
})
test('upgrade sends one status message for a new commit and not a plain restart',async t=>{
 const f=await fixture(t);await f.notice.start()
 assert.match(f.sent[0][1],/已升级到 aaaaaaa/)
 await f.notice.start();assert.equal(f.sent.length,1)
 await f.release(b);const next=new LifecycleNotice({stateDir:f.notice.stateDir,sourceDir:f.notice.sourceDir,owners:['owner'],send:async(owner,text)=>{f.sent.push([owner,text]);return {status:'accepted'}}})
 await next.start();assert.equal(f.sent.length,2);assert.match(f.sent[1][1],/bbbbbbb/)
})
test('a branch install without release metadata does not format a null upgrade',async t=>{
 const f=await fixture(t);await f.notice.start()
 await rm(join(f.notice.sourceDir,'.weixin-link-release.json'))
 const sent=[];const branch=new LifecycleNotice({stateDir:f.notice.stateDir,sourceDir:f.notice.sourceDir,owners:['owner'],send:async(_owner,text)=>{sent.push(text);return {status:'accepted'}}})
 await branch.start();await branch.onInbound('owner')
 assert.deepEqual(sent,[])
 assert.equal((await f.saved()).commit,a)
})
test('an account already welcomed by the old flow receives an upgrade notice',async t=>{
 const f=await fixture(t,{welcomePending:true});const legacy=join(f.notice.stateDir,basename(f.notice.path('owner')).replace('lifecycle-notice-','welcome-'))
 await writeFile(legacy,JSON.stringify({state:'accepted'}));await f.notice.start()
 assert.match(f.sent[0][1],/已升级到/);assert.equal((await f.saved()).kind,'upgrade')
})
test('definitive context rejection defers until a fresh inbound, unknown is not retried',async t=>{
 const f=await fixture(t);f.state.result=Object.assign(Error('rejected'),{name:'ApiError',errcode:-2,payload:{ret:-2}})
 await f.notice.start();assert.equal((await f.saved()).status,'deferred');assert.equal(f.sent.length,1)
 await f.notice.start();assert.equal(f.sent.length,1)
 f.state.result='accepted';await f.notice.onInbound('owner');assert.equal((await f.saved()).status,'accepted');assert.equal(f.sent.length,2)
 await f.release(b);f.state.result=Error('timeout');await f.notice.start();assert.equal((await f.saved()).status,'unknown')
 await f.notice.onInbound('owner');assert.equal(f.sent.length,3)
})

test('tagged release upgrade reports its own changelog once, without a network dependency',async t=>{
 const f=await fixture(t);await f.notice.start()
 await writeFile(join(f.notice.sourceDir,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'v1.2.0',commit:b}))
 await writeFile(join(f.notice.sourceDir,'CHANGELOG.md'),'# Changelog\n## 1.3.0\n- Future change\n## 1.2.0\n- Correct installed highlight\n## 1.1.0\n- Old change')
 await f.notice.start()
 assert.equal(f.sent.length,2);assert.match(f.sent[1][1],/已升级到 v1.2.0/)
 assert.match(f.sent[1][1],/Correct installed highlight/);assert.doesNotMatch(f.sent[1][1],/Future change|Old change/)
 assert.match(f.sent[1][1],/releases\/tag\/v1.2.0/)
 await f.notice.start();await f.notice.onInbound('owner');assert.equal(f.sent.length,2)
})
test('tagged release without changelog explicitly reports absent highlights',async t=>{
 const f=await fixture(t)
 await writeFile(join(f.notice.sourceDir,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'v1.2.0',commit:b}))
 await f.notice.start();assert.match(f.sent[0][1],/暂未提供核心更新摘要/);assert.match(f.sent[0][1],/releases\/tag\/v1.2.0/)
})


test('new pairing login identities remain silent on local snapshots',async t=>{
 const f=await fixture(t,{welcomePending:true});await rm(join(f.notice.sourceDir,'.weixin-link-release.json'))
 for(let i=0;i<2;i++){
  const loginId=await recordWelcomeRequest(f.notice.stateDir)
  const next=new LifecycleNotice({stateDir:f.notice.stateDir,sourceDir:f.notice.sourceDir,owners:['owner'],...await readWelcomeRequest(f.notice.stateDir),send:async()=>assert.fail('no pairing announcement')})
  await Promise.all([next.start(),next.onInbound('owner')]);assert.equal((await f.saved()).loginId,loginId);assert.equal((await f.saved()).status,'suppressed')
 }
})

test('publishing a local snapshot proactively notifies the owner once',async t=>{
 const f=await fixture(t)
 const {localUpgradeMarker,watchLocalUpgrade}=await import('../../src/infrastructure/updates/local-upgrade-notice.mjs')
 const {sourceDir}=f.notice
 await rm(join(sourceDir,'.weixin-link-release.json'))
 await f.notice.start()
 assert.deepEqual(f.sent,[])
 const notified=Promise.withResolvers()
 const close=watchLocalUpgrade(sourceDir,()=>f.notice.start().then(notified.resolve,notified.reject))
 t.after(close)
 const timeout=setTimeout(()=>notified.reject(Error('notification timed out')),5000)
 t.after(()=>clearTimeout(timeout))
 await writeFile(join(sourceDir,localUpgradeMarker),JSON.stringify({version:1,tree:b}))
 await notified.promise
 await f.notice.start()
 await f.notice.onInbound('owner')
 assert.deepEqual(f.sent,[['owner','微信助手已更新到本地新版，可以继续使用了。']])
})
