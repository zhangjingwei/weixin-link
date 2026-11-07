import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ChatUpgrader,chatUpgradeCommand,readChatUpgrade,scheduleChatUpgrade} from '../../src/setup/chat-upgrade.mjs'
import {performChatUpgrade} from '../../src/setup/chat-upgrade-worker.mjs'

const oldCommit='a'.repeat(40),newCommit='b'.repeat(40)
test('upgrade command matches only exact short or legacy text',()=>{
 assert.deepEqual(chatUpgradeCommand(' 升级 '),{action:'upgrade'})
 assert.deepEqual(chatUpgradeCommand('升级微信机器人'),{action:'upgrade'})
 assert.equal(chatUpgradeCommand('帮我升级'),null)
})
test('upgrade request checks main release and schedules once without invoking installer',async t=>{
 const home=await mkdtemp(join(tmpdir(),'chat-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const target=join(home,'source');await mkdir(target)
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:oldCommit}))
 const sent=[],scheduled=[],upgrader=new ChatUpgrader({home,target,latest:async()=>newCommit,deployment:async()=>({services:[{active:true,stateDir:target}]}),schedule:async request=>scheduled.push(request)})
 await upgrader.handle(value=>sent.push(value))
 assert.equal(scheduled.length,1);assert.equal((await readChatUpgrade(home)).status,'waiting_idle');assert.match(sent[0],/已安排空闲后升级/)
 await upgrader.handle(value=>sent.push(value))
 assert.equal(scheduled.length,1);assert.match(sent[1],/未重复提交/)
})
test('upgrade request refuses an unknown source and skips current main',async t=>{
 const home=await mkdtemp(join(tmpdir(),'chat-upgrade-source-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const target=join(home,'source');await mkdir(target)
 const sent=[],upgrader=new ChatUpgrader({home,target,latest:async()=>newCommit,deployment:async()=>{throw Error('must not run')},schedule:async()=>{throw Error('must not schedule')}})
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'other/repo',ref:'main',commit:oldCommit}))
 await upgrader.handle(value=>sent.push(value));assert.match(sent[0],/来源未核实/)
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:newCommit}))
 await upgrader.handle(value=>sent.push(value));assert.match(sent[1],/已是 main 最新版本/)
})
test('upgrade waits for an existing account maintenance request',async t=>{
 const home=await mkdtemp(join(tmpdir(),'chat-upgrade-conflict-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const target=join(home,'source'),stateDir=join(home,'account');await mkdir(target);await mkdir(stateDir)
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:oldCommit}))
 await writeFile(join(stateDir,'agent-switch.json'),JSON.stringify({status:'waiting_idle'}))
 const sent=[],upgrader=new ChatUpgrader({home,target,latest:async()=>newCommit,deployment:async()=>({services:[{active:true,stateDir}]}),schedule:async()=>{throw Error('must not schedule')}})
 await upgrader.handle(value=>sent.push(value));assert.match(sent[0],/账号维护正在进行/)
 assert.equal(await readChatUpgrade(home),null)
})
test('macOS upgrade worker is launched once and does not keep restarting',async t=>{
 const home=await mkdtemp(join(tmpdir(),'chat-upgrade-launch-'));t.after(()=>rm(home,{recursive:true,force:true}))
 await mkdir(join(home,'.local/share/weixin-link'),{recursive:true})
 const calls=[],request={id:'11111111-2222-3333-4444-555555555555'}
 await scheduleChatUpgrade(request,{platform:'darwin',home,run:async(...args)=>calls.push(args)})
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1].slice(0,2),['bootstrap','gui/'+process.getuid()])
 const plist=await readFile(join(home,'.local/share/weixin-link/chat-upgrade-'+request.id+'.plist'),'utf8')
 assert.match(plist,/<key>RunAtLoad<\/key><true\/>/);assert.match(plist,/<key>KeepAlive<\/key><false\/>/)
})
test('worker waits for all active accounts, runs installer once, then verifies both',async t=>{
 const target=await mkdtemp(join(tmpdir(),'chat-upgrade-worker-'));t.after(()=>rm(target,{recursive:true,force:true}))
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:newCommit}))
 let request={id:'request-1',commit:newCommit,status:'waiting_idle'},busy=true,installCalls=0
 const services=[{id:'default',active:true},{id:'second',active:true}]
 const adapter={services,status:async service=>({ready:true,idle:service.id==='default'||!busy,draining:false}),}
 const result=await performChatUpgrade({home:'/unused',target,requestId:request.id,read:async()=>request,save:async(h,value)=>{request=value},deployment:async()=>adapter,run:async(_bin,_args,options)=>{assert.equal(options.env.WEIXIN_LINK_EXPECTED_COMMIT,newCommit);installCalls++;busy=false},wait:async()=>{busy=false},attempts:3})
 assert.equal(result.status,'complete');assert.equal(installCalls,1);assert.equal(request.status,'complete')
})
test('worker rejects an installed commit other than the approved target',async t=>{
 const target=await mkdtemp(join(tmpdir(),'chat-upgrade-mismatch-'));t.after(()=>rm(target,{recursive:true,force:true}))
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:'c'.repeat(7)}))
 let request={id:'request-2',commit:newCommit,previous:oldCommit,status:'waiting_idle'}
 const adapter={services:[{id:'default',active:true}],status:async()=>({ready:true,idle:true,draining:false})}
 await assert.rejects(performChatUpgrade({home:'/unused',target,requestId:request.id,read:async()=>request,save:async(_home,value)=>{request=value},deployment:async()=>adapter,run:async()=>{},attempts:1}),/CHAT_UPGRADE_VERSION_UNVERIFIED/)
 assert.equal(request.status,'failed')
})
