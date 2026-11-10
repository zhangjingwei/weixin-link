import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runTerminalWizard} from '../../src/setup/terminal-wizard.mjs'
import {probeTerminalModel} from '../../src/setup/terminal-model-probe.mjs'
import {readTerminalSetupStatus} from '../../src/setup/terminal-setup-status.mjs'
import {saveProviderProfile,readProviderProfile} from '../../src/setup/provider-profile.mjs'
import {accountPaths} from '../../src/infrastructure/accounts/account-store.mjs'

async function fixture(t){const home=await mkdtemp(join(tmpdir(),'terminal-wizard-')),stateDir=accountPaths('default',home).stateDir;await mkdir(stateDir,{recursive:true});t.after(()=>rm(home,{recursive:true,force:true}));return {home,stateDir}}

test('terminal wizard configures a provider, checks Codex and records only verified inference',async t=>{
 const f=await fixture(t),calls=[],messages=[]
 const result=await runTerminalWizard({home:f.home,choose:async()=> '2',configure:async(kind,accountId,{home})=>{calls.push('configure');await saveProviderProfile({kind,accountId,home,apiKey:'sk-private-test-key'})},check:async()=>calls.push('check'),probe:async()=>{calls.push('probe');return {verified:true,provider:'deepseek',model:'deepseek-flash'}},applyService:async()=>{calls.push('apply');return false},write:text=>messages.push(text)})
 assert.equal(result.verified,true);assert.deepEqual(calls,['configure','check','probe','apply'])
 assert.equal((await readTerminalSetupStatus(f.stateDir)).provider,'deepseek')
 assert(!messages.join('\n').includes('sk-private-test-key'))
})

test('subscription remains selectable and clears a previous provider before testing',async t=>{
 const f=await fixture(t),calls=[];await saveProviderProfile({kind:'qwen',workspaceId:'workspace123',apiKey:'sk-private-test-key',home:f.home})
 await runTerminalWizard({home:f.home,choose:async()=> '1',login:async({send})=>{calls.push('login');await send('官方设备授权提示')},check:async()=>calls.push('check'),probe:async()=>{calls.push('probe');return {verified:true,provider:'subscription',model:null}},applyService:async()=>{calls.push('apply');return false},write:()=>{}})
 assert.deepEqual(calls,['login','check','probe','apply']);assert.equal(await readProviderProfile(f.stateDir),null)
 assert.equal((await readTerminalSetupStatus(f.stateDir)).provider,'subscription')
})

test('failed probe followed by deferral leaves no verified marker',async t=>{
 const f=await fixture(t),choices=['4','0'],messages=[]
 const result=await runTerminalWizard({home:f.home,choose:async()=>choices.shift(),configure:async()=>{},check:async()=>{},probe:async()=>{throw Error('raw upstream secret should not print')},write:text=>messages.push(text)})
 assert.equal(result.verified,false);assert.equal(await readTerminalSetupStatus(f.stateDir),null)
 assert(!messages.join('\n').includes('raw upstream secret'))
})

test('English terminal wizard uses English prompts and keeps the same provider choices',async t=>{
 const f=await fixture(t),prompts=[],messages=[]
 await runTerminalWizard({home:f.home,language:'en',choose:async prompt=>{prompts.push(prompt);return '0'},write:text=>messages.push(text)})
 assert(prompts[0].includes('Subscription sign-in'))
 assert(prompts[0].includes('DeepSeek'))
 assert(prompts[0].includes('Qwen'))
 assert(messages[0].includes('not been verified'))
})
test('selected English language is saved for the first WeChat notice',async t=>{
 const f=await fixture(t)
 await runTerminalWizard({home:f.home,language:'en',choose:async()=> '1',login:async()=>{},check:async()=>{},probe:async()=>({verified:true,provider:'subscription',model:null}),applyService:async()=>false,write:()=>{}})
 assert.equal((await readTerminalSetupStatus(f.stateDir)).language,'en')
})

test('service apply failure does not leave a verified marker',async t=>{
 const f=await fixture(t),choices=['2','0']
 const result=await runTerminalWizard({home:f.home,choose:async()=>choices.shift(),configure:async(kind,accountId,{home})=>saveProviderProfile({kind,accountId,home,apiKey:'sk-private-test-key'}),check:async()=>{},probe:async()=>({verified:true,provider:'deepseek',model:'deepseek-flash'}),applyService:async()=>{throw Error('MODEL_SERVICE_RESTART_NOT_SCHEDULED')},write:()=>{}})
 assert.equal(result.deferred,true)
 assert.equal(await readTerminalSetupStatus(f.stateDir),null)
})

test('terminal probe passes Responses configuration and checks the model output',async t=>{
 const f=await fixture(t);await saveProviderProfile({kind:'kimi',apiKey:'sk-private-test-key',home:f.home})
 let captured
 const result=await probeTerminalModel({home:f.home,execute:async(binary,args,options)=>{captured={binary,args,options};const path=args[args.indexOf('--output-last-message')+1],nonce=args.at(-1).split('：').at(-1);await writeFile(path,nonce+'\n')}})
 assert.equal(result.provider,'kimi');assert.equal(result.verified,true)
 assert(captured.args.includes('--ephemeral'));assert(captured.args.join(' ').includes('wire_api="responses"'))
 assert(captured.args.join(' ').includes('model_context_window=1048576'))
 assert(!captured.args.join(' ').includes('sk-private-test-key'))
 assert.equal(captured.options.env.WECHAT_KIMI_API_KEY,'sk-private-test-key')
})

test('terminal probe reports a timed-out inference without marking setup verified',async t=>{
 const f=await fixture(t),choices=['1','0'],messages=[]
 const probe=options=>probeTerminalModel({...options,execute:async(_binary,_args,runOptions)=>{
  assert.equal(runOptions.timeout,60000)
  throw Object.assign(Error('private upstream details'),{killed:true,signal:'SIGTERM'})
 }})
 const result=await runTerminalWizard({home:f.home,choose:async()=>choices.shift(),login:async()=>{},check:async()=>{},probe,write:text=>messages.push(text)})
 assert.equal(result.deferred,true)
 assert.equal(await readTerminalSetupStatus(f.stateDir),null)
 assert(messages.some(message=>message.includes('MODEL_PROBE_TIMEOUT')&&message.includes('OpenAI')))
 assert(!messages.join('\n').includes('private upstream details'))
})

test('terminal probe distinguishes a wrong model answer from a connection timeout',async t=>{
 const f=await fixture(t)
 await assert.rejects(probeTerminalModel({home:f.home,execute:async(_binary,args)=>{
  await writeFile(args[args.indexOf('--output-last-message')+1],'wrong answer')
 }}),/MODEL_PROBE_RESPONSE_MISMATCH/)
})
