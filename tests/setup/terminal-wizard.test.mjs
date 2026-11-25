import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runTerminalWizard as runWizard} from '../../src/setup/terminal-wizard.mjs'
import {probeTerminalModel,runModelProbeCommand} from '../../src/setup/terminal-model-probe.mjs'
import {readProviderProfile} from '../../src/setup/provider-profile.mjs'
import {accountPaths} from '../../src/infrastructure/accounts/account-store.mjs'

const runTerminalWizard=runWizard

async function fixture(t){const home=await mkdtemp(join(tmpdir(),'terminal-wizard-')),stateDir=accountPaths('default',home).stateDir;await mkdir(stateDir,{recursive:true});t.after(()=>rm(home,{recursive:true,force:true}));return {home,stateDir}}

test('wizard explains WeChat executor binding without asking for a model',async t=>{
 const f=await fixture(t),messages=[]
 await runTerminalWizard({home:f.home,write:value=>messages.push(value)})
 assert.match(messages.join(' '),/执行器|executor/)
 assert.equal(await readProviderProfile(f.stateDir),null)
})

test('terminal probe closes unused stdin before waiting for Codex',async()=>{
 const {stdout}=await runModelProbeCommand(process.execPath,['-e',"process.stdin.resume();process.stdin.once('end',()=>process.stdout.write('stdin-closed'))"],{timeout:3000})
 assert.equal(stdout,'stdin-closed')
})

test('terminal probe distinguishes a wrong model answer from a connection timeout',async t=>{
 const f=await fixture(t)
 await assert.rejects(probeTerminalModel({binary:process.execPath,home:f.home,execute:async(_binary,args)=>{
  await writeFile(args[args.indexOf('--output-last-message')+1],'wrong answer')
 }}),/MODEL_PROBE_RESPONSE_MISMATCH/)
})

test('a verified nonce survives CLI shutdown timeout, but missing or invalid answers remain unverified',async t=>{
 const f=await fixture(t)
 for(const answer of ['valid','wrong',null]){
  const probe=()=>probeTerminalModel({binary:process.execPath,home:f.home,execute:async(_binary,args)=>{
   if(answer!==null)await writeFile(args[args.indexOf('--output-last-message')+1],answer==='valid'?args.at(-1).split('：').at(-1):'wrong')
   throw Object.assign(Error('private details'),{killed:true,signal:'SIGTERM',code:null})
  }})
  if(answer==='valid')assert.equal((await probe()).verified,true)
  else await assert.rejects(probe(),/MODEL_PROBE_TIMEOUT/)
 }
})

test('a non-timeout process failure cannot pass verification merely because a nonce file exists',async t=>{
 const f=await fixture(t)
 for(const error of [Object.assign(Error('upstream failed'),{code:1}),Object.assign(Error('buffer overflow'),{killed:true,signal:'SIGTERM',code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'})]){
  await assert.rejects(probeTerminalModel({binary:process.execPath,home:f.home,execute:async(_binary,args)=>{
   await writeFile(args[args.indexOf('--output-last-message')+1],args.at(-1).split('：').at(-1))
   throw error
  }}),/MODEL_PROBE_FAILED/)
 }
})

test('real subprocess can finish its answer before timing out during shutdown',async t=>{
 const f=await fixture(t)
 const result=await probeTerminalModel({binary:process.execPath,home:f.home,timeoutMs:1000,execute:(_binary,args,options)=>runModelProbeCommand(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],process.argv[2]);setInterval(()=>{},1000)",args[args.indexOf('--output-last-message')+1],args.at(-1).split('：').at(-1)],options)})
 assert.equal(result.verified,true)
})

test('model probe uses the explicitly selected subscription model',async t=>{
 const f=await fixture(t)
 const result=await probeTerminalModel({binary:process.execPath,home:f.home,model:'test-sol',execute:async(binary,args)=>{
  assert.equal(args[args.indexOf('--model')+1],'test-sol')
  await writeFile(args[args.indexOf('--output-last-message')+1],args.at(-1).split('：').at(-1))
 }})
 assert.equal(result.model,'test-sol')
})
