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
test('Mac rechecks account evidence after expiration and reopening', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'mac-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));const src=join(root,'src'),write=async(file,content)=>{const path=join(src,file);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content)}
 const env={...process.env,HOME:root,CODEX_HOME:join(root,'.codex')};const run=action=>exec(process.execPath,[bridge,root,action],{env});const status=async()=>JSON.parse((await run('status')).stdout)
 await write('setup/account-manager.mjs',`import fs from 'node:fs';const row=JSON.parse(fs.readFileSync(process.env.HOME+'/row'));if(process.argv[2]==='refresh-qr'){row.pairing='waiting_scan';fs.writeFileSync(process.env.HOME+'/row',JSON.stringify(row));console.log('{}')}else if(process.argv[2]==='list'){console.log(JSON.stringify({accounts:[row]}))}else process.exit(1)`)
 await write('infrastructure/accounts/account-store.mjs','export const accountPaths=()=>({})')
 const row=async pairing=>writeFile(join(root,'row'),JSON.stringify({pairing,credential_status:'missing'}));await row('qr_refresh_required');assert.deepEqual(await status(),{phase:'qr_refresh_required'});await write('infrastructure/wechat/pairing-state.mjs',`export const currentLoginLink=async()=>({url:'https://example.invalid/test-only',freshness_seconds:80})`);await run('qr');assert.equal((await status()).url,'https://example.invalid/test-only');await row('qr_expired');assert.equal((await status()).url,undefined);await run('qr');assert.equal((await status()).phase,'waiting_scan')
 await assert.rejects(run('authorize'))
 await writeFile(join(root,'row'),JSON.stringify({ready:true}));assert.deepEqual(await status(),{phase:'ready'});await assert.rejects(run('qr'))
})
