import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),script=fileURLToPath(new URL('../../qr.sh',import.meta.url))
async function fixture(t,{ready=false,running=false,account='default',legacy=false,stopFails=false}={}){
 const home=await mkdtemp(join(tmpdir(),'weixin-qr-script-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,legacy?'.local/share/zero-link/source':'.local/share/weixin-link/source')
 await mkdir(join(root,'src/wechat'),{recursive:true})
 await writeFile(join(root,'package.json'),' {"name":"weixin-link"}')
 await writeFile(join(root,'src/wechat/account-manager.mjs'),`
 import {writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
 if(process.argv[2]==='list')console.log(JSON.stringify({accounts:[{account:${JSON.stringify(account)},ready:${ready},service_active:${running}}]}));
 else if(process.argv[2]==='stop'){if(${stopFails}){console.log(JSON.stringify({ok:false,error:'STOP_FAILED'}));process.exit(1)}writeFileSync(new URL('../../stopped',import.meta.url),'stopped');console.log(JSON.stringify({ok:true,status:'stopped'}))}
 else if(process.argv[2]==='refresh-qr'){
  writeFileSync(new URL('../../refreshed',import.meta.url),process.argv[3]);
  const path=fileURLToPath(new URL('../../login.png',import.meta.url));writeFileSync(path,'fixture');
  console.log(JSON.stringify({ok:true,status:'scan_to_login',path}));
 }else process.exit(2);
 `)
 return {home,root,env:{...process.env,HOME:home,WEIXIN_LINK_DIR:'',ZERO_LINK_DIR:'',WEIXIN_LINK_ACCOUNT:'',WEIXIN_LINK_RELOGIN:'',SSH_CONNECTION:'fixture'}}
}
test('QR script refreshes a legacy JSON-only installation without leaking JSON',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{legacy:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('登录二维码已刷新'));assert(r.stdout.includes('login.png'))
 assert(!r.stdout.includes('"ok"'));assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
})
test('QR script reports local readiness without claiming the remote binding is valid',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{ready:true,running:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('不能确认微信绑定仍有效'));assert(r.stdout.includes('--relogin'));assert(!(await readdir(f.root)).includes('refreshed'))
})
test('running but unready accounts are not stopped for QR refresh',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{running:true})
 await assert.rejects(exec('sh',[script],{env:f.env}),e=>e.stderr.includes('ACCOUNT_RUNNING_NOT_READY'))
 assert(!(await readdir(f.root)).includes('refreshed'))
})
test('custom source paths and named accounts work outside the source directory',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{account:'bot2'})
 const r=await exec('sh',[script,'bot2'],{cwd:tmpdir(),env:{...f.env,WEIXIN_LINK_DIR:f.root}})
 assert(r.stdout.includes('二维码已刷新'));assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'bot2')
})
test('an invalid account is refused before executing account operations',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t)
 await assert.rejects(exec('sh',[script,'../other'],{env:f.env}),e=>e.stderr.includes('INVALID_ACCOUNT_ID'))
 assert(!(await readdir(f.root)).includes('refreshed'))
})
test('explicit relogin bypasses stale readiness only after a confirmed safe stop',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{ready:true,running:true})
 const r=await exec('sh',[script,'--relogin'],{env:f.env})
 assert(r.stdout.includes('安全停止'));assert(r.stdout.includes('二维码已刷新'))
 assert.equal(await readFile(join(f.root,'stopped'),'utf8'),'stopped')
 assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
})
test('relogin environment flag works when the service is already not ready',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{running:true})
 await exec('sh',[script],{env:{...f.env,WEIXIN_LINK_RELOGIN:'1'}})
 assert.equal(await readFile(join(f.root,'stopped'),'utf8'),'stopped')
 assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
})
test('failed safe stop prevents a new pairing attempt',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{ready:true,running:true,stopFails:true})
 await assert.rejects(exec('sh',[script,'--relogin'],{env:f.env}),e=>e.stderr.includes('STOP_FAILED'))
 assert(!(await readdir(f.root)).includes('refreshed'))
})
