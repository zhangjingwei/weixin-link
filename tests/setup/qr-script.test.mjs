import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),script=fileURLToPath(new URL('../../qr.sh',import.meta.url))
async function fixture(t,{ready=false,running=false,account='default',legacy=false}={}){
 const home=await mkdtemp(join(tmpdir(),'weixin-qr-script-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,legacy?'.local/share/zero-link/source':'.local/share/weixin-link/source')
 await mkdir(join(root,'src/wechat'),{recursive:true})
 await writeFile(join(root,'package.json'),' {"name":"weixin-link"}')
 await writeFile(join(root,'src/wechat/account-manager.mjs'),`
 import {writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
 if(process.argv[2]==='list')console.log(JSON.stringify({accounts:[{account:${JSON.stringify(account)},ready:${ready},service_active:${running}}]}));
 else if(process.argv[2]==='refresh-qr'){
  writeFileSync(new URL('../../refreshed',import.meta.url),process.argv[3]);
  const path=fileURLToPath(new URL('../../login.png',import.meta.url));writeFileSync(path,'fixture');
  console.log(JSON.stringify({ok:true,status:'scan_to_login',path}));
 }else process.exit(2);
 `)
 return {home,root,env:{...process.env,HOME:home,WEIXIN_LINK_DIR:'',ZERO_LINK_DIR:'',WEIXIN_LINK_ACCOUNT:'',SSH_CONNECTION:'fixture'}}
}
test('QR script refreshes a legacy JSON-only installation without leaking JSON',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{legacy:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('登录二维码已刷新'));assert(r.stdout.includes('login.png'))
 assert(!r.stdout.includes('"ok"'));assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
})
test('QR script leaves online accounts alone and explains why no new code is needed',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{ready:true,running:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('已在线'));assert(!(await readdir(f.root)).includes('refreshed'))
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
