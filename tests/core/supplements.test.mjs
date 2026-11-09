import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SessionManager,controlCommand} from '../../src/base/codex/codex-session.mjs'
import {createCommandClassifier} from '../../src/wechat/command-classifier.mjs'
import {transition} from '../../src/core/lifecycle.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'wechat-steer-')),calls=[],out=[]
 const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner','other'],providerEnv:{},remoteControl:async()=>({stop_confirmed:true,tasks:[]}),rpcFactory:()=>{throw Error('Must not connect')}}).init()
 const token=manager.lifecycle.capture('owner')
 const rpc={closed:false,close(){this.closed=true},async request(method,params){calls.push({method,params});return {turnId:params.expectedTurnId}}}
 const session={userId:'owner',threadId:'thread-1',turnId:'turn-1',traceId:'trace-1',turnReady:true,turnStarted:true,finalReceived:false,workToken:token,rpc,queue:[]}
 transition(session,'running');manager.sessions.set('owner',session);manager.state.users.owner={threadId:session.threadId}
 t.after(async()=>{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})})
 return {manager,session,rpc,calls,out,reply:async text=>out.push(text),dir}
}
test('supplement syntax requires explicit separator and preserves multiline content',()=>{
 for(const input of ['补充 x','补充：x','补充: x','补充\nx'])assert.deepEqual(controlCommand(input),{action:'steer',text:'x'})
 assert.deepEqual(controlCommand('补充'),{action:'steer',text:''})
 assert.equal(controlCommand('补充说明这个功能'),null)
 assert.equal(controlCommand('请补充 x'),null)
 assert.deepEqual(controlCommand('补充 a\nb'),{action:'steer',text:'a\nb'})
})
test('supplements reach exact active turn without queue or new turn; receipt follows acceptance and duplicates ignored',async t=>{
 const f=await fixture(t);let release
 f.rpc.request=async(method,params)=>{f.calls.push({method,params});return new Promise(r=>release=r)}
 const pending=f.manager.handle('owner','补充 先别部署',f.reply,'message-1')
 while(!release)await new Promise(r=>setImmediate(r))
 assert.equal(f.out.length,0)
 assert.equal(f.manager.state.users.owner.supplements[0].status,'unknown')
 release({turnId:'turn-1'});await pending
 assert.deepEqual(f.calls,[{method:'turn/steer',params:{threadId:'thread-1',expectedTurnId:'turn-1',input:[{type:'text',text:'先别部署'}]}}])
 assert.equal(f.session.queue.length,0);assert.match(f.out[0],/已提交/)
 await f.manager.handle('owner','补充 先别部署',f.reply,'message-1');assert.equal(f.calls.length,1)
 assert.equal(f.manager.state.users.owner.supplements[0].status,'accepted')
})
test('empty, idle, starting, finalizing, stopped and unauthorized supplements never submit',async t=>{
 const f=await fixture(t)
 await f.manager.handle('owner','补充',f.reply);assert.match(f.out.at(-1),/用法/)
 f.session.turnReady=false;await f.manager.handle('owner','补充 x',f.reply);assert.match(f.out.at(-1),/仍在启动/);f.session.turnReady=true
 for(const state of ['idle','delivering','stopping']){transition(f.session,state);await f.manager.handle('owner','补充 x',f.reply);assert.match(f.out.at(-1),/未提交/)}
 transition(f.session,'running');f.session.finalReceived=true;await f.manager.handle('owner','补充 x',f.reply);f.session.finalReceived=false
 await f.manager.handle('other','补充 x',f.reply);await f.manager.handle('stranger','补充 x',f.reply)
 f.manager.lifecycle.cancel('owner');await f.manager.handle('owner','补充 x',f.reply)
 assert.equal(f.calls.length,0)
})
test('task completing during durable save never redirects supplement to next task',async t=>{
 const f=await fixture(t),save=f.manager.save.bind(f.manager);let n=0
 f.manager.save=async()=>{await save();if(++n===1)f.session.turnId='turn-2'}
 await f.manager.steer('owner','x',f.reply,f.manager.lifecycle.capture('owner'))
 assert.equal(f.calls.length,0);assert.match(f.out.at(-1),/未转入其他任务/)
})
for(const [label,error,status,pattern]of [
 ['reject',Object.assign(Error('no active turn'),{definitiveRpcError:true}),'rejected',/未被/],
 ['timeout',Object.assign(Error('timeout'),{requestTimeout:true}),'unknown',/不确定/],
 ['disconnect',Object.assign(Error('closed'),{connectionClosed:true}),'unknown',/不确定/],
 ['mismatched receipt',null,'unknown',/不确定/],
])test(label+' never retries or queues',async t=>{
 const f=await fixture(t);f.rpc.request=async(...args)=>{f.calls.push(args);if(error)throw error;return {turnId:'wrong'}}
 await f.manager.handle('owner','补充 x',f.reply)
 assert.equal(f.calls.length,1);assert.equal(f.session.queue.length,0)
 assert.equal(f.manager.state.users.owner.supplements[0].status,status);assert.match(f.out.at(-1),pattern)
})
test('storage failure before submission prevents RPC',async t=>{
 const f=await fixture(t);f.manager.save=async()=>{throw Error('disk full')}
 await assert.rejects(f.manager.steer('owner','x',f.reply,f.manager.lifecycle.capture('owner')),/disk full/)
 assert.equal(f.calls.length,0)
})
test('bot classifies supplement as a control at ingress and dispatch, without a queued receipt',async()=>{
 const intent=createCommandClassifier()({userId:'owner',text:'补充 保留接口'})
 assert.equal(intent.kind,'session');assert.equal(intent.value.action,'steer')
 const bot=await readFile(new URL('../../src/wechat/bot.mjs',import.meta.url),'utf8')
 assert.match(bot,/if\(control\)await handleMessage\(message\)/)
 const application=await readFile(new URL('../../src/application/intake/message-application.mjs',import.meta.url),'utf8')
 assert.match(application,/if\(!control&&notice/)
 assert.match(application,/control.action==='steer'\?messageId:undefined/)
})
