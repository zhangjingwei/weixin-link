import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {InstallationWizard} from '../../src/setup/setup-wizard.mjs'
import {SetupController} from '../../src/setup/setup-controller.mjs'

async function fixture(t,status={installed:true,loggedIn:false,profileKind:null,activeKind:'subscription'}){
 const stateDir=await mkdtemp(join(tmpdir(),'numeric-wizard-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
 const calls=[],out=[],ops={availability:async()=>({...status}),manual:async reply=>reply('manual'),errorText:()=> '可重试',perform:async name=>{calls.push(name);if(name==='login')status.loggedIn=true}}
 const w=new InstallationWizard({stateDir,ops});await w.ready
 const reply=async text=>out.push(text),click=async(n,owner='u')=>{const command=w.route(n,owner);assert(command);const [,revision,value]=command.split(':');return w.choice(owner,revision,value,reply)}
 return {w,ops,status,stateDir,calls,out,reply,click}
}

test('first push offers three model access methods and leaves ordinary numbers alone after exit',async t=>{
 const f=await fixture(t);assert.equal(f.w.route('1','u'),null)
 await f.w.start('u',f.reply);assert.match(f.out.at(-1),/1\. 订阅登录[\s\S]*2\. 配置 DeepSeek[\s\S]*3\. 配置 Qwen/)
 await f.click('3');assert.equal(f.w.states.get('u').provider,'qwen')
 await f.w.exit('u',f.reply);assert.equal(f.w.route('1','u'),null)
})
test('subscription path logs in and checks before real model test',async t=>{
 const f=await fixture(t);await f.w.start('u',f.reply);await f.click('1');assert.equal(f.w.states.get('u').phase,'subscription')
 await f.click('1');assert.equal(f.w.states.get('u').phase,'modelTest');await f.click('1')
 assert.equal(f.w.states.get('u').active,false);assert.deepEqual(f.calls,['login','check','modelTest'])
})
test('configured third-party path requires active service restart and never calls device login',async t=>{
 const f=await fixture(t);await f.w.start('u',f.reply);await f.click('2');assert.equal(f.w.states.get('u').phase,'provider')
 assert.match(f.out.at(-1),/provider-config deepseek/);assert.match(f.out.at(-1),/不要发送到微信/)
 f.status.profileKind='deepseek';await f.click('1');assert.equal(f.w.states.get('u').phase,'provider');assert.match(f.out.at(-1),/重启/)
 f.status.activeKind='deepseek';await f.click('1');assert.equal(f.w.states.get('u').phase,'modelTest');assert.deepEqual(f.calls,[])
})
test('stale digit cannot be applied to next screen',async t=>{const f=await fixture(t);await f.w.start('u',f.reply);const stale=f.w.route('1','u').split(':');await f.click('1');await f.w.choice('u',stale[1],stale[2],f.reply);assert.deepEqual(f.calls,[]);assert.match(f.out.at(-1),/步骤已变化/)})
test('restart does not repeat an unfinished operation or persist credentials',async t=>{
 const f=await fixture(t);await f.w.start('u',f.reply);await f.click('1')
 const s=f.w.states.get('u');s.running=true;s.lastOperation='login';await f.w.save(s)
 const resumed=new InstallationWizard({stateDir:f.stateDir,ops:f.ops});await resumed.ready;await resumed.start('u',f.reply)
 assert.equal(resumed.states.get('u').phase,'recovery');assert.deepEqual(f.calls,[])
 for(const file of await readdir(join(f.stateDir,'installation-wizard')))assert(!String(await readFile(join(f.stateDir,'installation-wizard',file))).includes('API Key'))
})
test('failed model test stays retryable',async t=>{const f=await fixture(t,{installed:true,loggedIn:true,profileKind:null,activeKind:'subscription'});f.ops.perform=async()=>{throw Error('inference failed')};await f.w.start('u',f.reply);await f.click('1');await f.click('1');assert.equal(f.w.states.get('u').phase,'modelTest');await f.click('1');assert.equal(f.w.states.get('u').active,true)})
test('exit command cancels an in-flight subscription login',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wizard-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 let started;const ready=new Promise(resolve=>started=resolve)
 const c=await new SetupController({stateDir:dir,home:dir,accountId:'default',runDoctor:async()=>({codexInstalled:true,codexLoggedIn:false}),runLogin:async({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('SETUP_CANCELLED')),{once:true})})}).init()
 const out=[],reply=async text=>out.push(text),options={scope:'u'};await c.handle('wizard',reply,options);await c.handle(c.command('1','u'),reply,options)
 const pending=c.handle(c.command('1','u'),reply,options);await ready;await c.handle('wizardExit',reply,options);await pending
 assert.equal(c.wizard.states.get('u').active,false);assert.equal(c.busy,false)
})
test('wizard digits are scoped to the opening conversation',async t=>{const f=await fixture(t);await f.w.start('u',f.reply,{executionKey:'a'});assert(f.w.route('1','u','a'));assert.equal(f.w.route('1','u','b'),null);await f.w.start('u',f.reply,{executionKey:'b'});assert(f.w.route('1','u','b'))})
