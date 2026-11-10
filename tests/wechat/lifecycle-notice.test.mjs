import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {LifecycleNotice,WELCOME_MESSAGE,welcomeMessage,upgradeMessage} from '../../src/wechat/lifecycle-notice.mjs'

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
test('fresh install sends one welcome immediately without waiting for inbound',async t=>{
 const f=await fixture(t,{welcomePending:true});await f.notice.start()
 assert.deepEqual(f.sent,[['owner',WELCOME_MESSAGE]])
 assert.equal(await f.notice.onInbound('owner'),null);assert.equal(f.sent.length,1);assert.equal((await f.saved()).status,'accepted')
})
test('English lifecycle copy covers connection and upgrade notices',()=>{
 assert(welcomeMessage('en').includes('connected'))
 assert(upgradeMessage(a,'en').includes('upgraded'))
})
test('first welcome can report terminal verification without opening a chat wizard',async t=>{
 const f=await fixture(t,{welcomePending:true})
 f.notice.welcomeText=async()=> '微信助手已连接，模型已通过安装终端的真实推理测试。'
 await f.notice.start();assert.match(f.sent[0][1],/安装终端的真实推理测试/)
 await f.notice.start();assert.equal(f.sent.length,1)
})
test('unknown first-welcome delivery is not resent automatically',async t=>{
 const f=await fixture(t,{welcomePending:true});f.state.result='unknown'
 await f.notice.start()
 assert.equal((await f.saved()).status,'unknown')
 await f.notice.onInbound('owner');assert.equal(f.sent.length,1)
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
