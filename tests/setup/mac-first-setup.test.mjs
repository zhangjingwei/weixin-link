import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),bridge=resolve('desktop/mac/setup-bridge.mjs')
test('Mac first setup refuses existing source, account data or registered agent', {skip:process.platform!=='darwin'},async t=>{
 for(const file of ['.local/share/weixin-link/source/history','.local/share/wechat-ping-bot/history','Library/LaunchAgents/com.wechat-assistant.wechat-ping-bot.plist']){const home=await mkdtemp(join(tmpdir(),'mac-preserve-'));t.after(()=>rm(home,{recursive:true,force:true}));const path=join(home,file);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'keep');await assert.rejects(exec('/bin/sh',['desktop/mac/first-install.sh'],{env:{...process.env,HOME:home}}),{code:41});assert.equal(await readFile(path,'utf8'),'keep')}
})
test('Mac rechecks account evidence after expiration, device cancellation and reopening', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'mac-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));const src=join(root,'src'),write=async(file,content)=>{const path=join(src,file);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content)}
 const env={...process.env,HOME:root,CODEX_HOME:join(root,'.codex')};const run=action=>exec(process.execPath,[bridge,root,action],{env});const status=async()=>JSON.parse((await run('status')).stdout)
 await write('setup/account-manager.mjs',`import fs from 'node:fs';const row=JSON.parse(fs.readFileSync(process.env.HOME+'/row'));if(process.argv[2]!=='list')process.exit(1);console.log(JSON.stringify({accounts:[row]}))`)
 await write('setup/provider-profile.mjs','export const accountProviderProfile=()=>null');await write('setup/install-config.mjs',`export const findCodex=()=>process.env.HOME+'/codex'`);await write('infrastructure/accounts/codex-home.mjs','export const accountCodexHome=()=>process.env.CODEX_HOME');await write('infrastructure/accounts/account-store.mjs','export const accountPaths=()=>({})');await write('setup/setup-login.mjs',`export * from ${JSON.stringify(new URL('../../src/setup/setup-login.mjs',import.meta.url).href)}`)
 const row=async pairing=>writeFile(join(root,'row'),JSON.stringify({pairing,credential_status:'missing'}));await row('qr_refresh_required');await writeFile(join(root,'codex'),`#!/bin/sh\ncase "$*" in 'login status') test -f "$HOME/auth";; 'login --help') echo --device-auth;; 'login --device-auth') echo 'https://auth.openai.com/codex/device ABCD-EFGH'; exec sleep 30;; esac\n`,{mode:0o700});assert.deepEqual(await status(),{phase:'qr_refresh_required',model:'missing'})
 const child=spawn(process.execPath,[bridge,root,'authorize'],{env,stdio:['pipe','pipe','ignore']});const done=new Promise(resolve=>child.once('close',resolve));const timer=setTimeout(()=>child.kill(),5000);try{const code=await new Promise((res,rej)=>{child.stdout.once('data',r=>res(JSON.parse(r)));child.once('exit',()=>rej(Error('no device prompt')))});assert.equal(code.device,'https://auth.openai.com/codex/device');child.stdin.end();assert.notEqual(await done,0)}finally{clearTimeout(timer);child.kill()};assert.equal((await status()).model,'missing');await writeFile(join(root,'auth'),'fixture');await writeFile(join(root,'row'),JSON.stringify({ready:true}));assert.deepEqual(await status(),{phase:'ready',model:'authorized'});await assert.rejects(run('qr'))
})
