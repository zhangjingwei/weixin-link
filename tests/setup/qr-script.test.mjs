import test from 'node:test'
import QRCode from 'qrcode'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),script=fileURLToPath(new URL('../../qr.sh',import.meta.url))
async function fixture(t,{ready=false,running=false,account='default',legacy=false,legacyManager=false,stopFails=false,stopNumeric=false}={}){
 const home=await mkdtemp(join(tmpdir(),'weixin-qr-script-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const root=join(home,legacy?'.local/share/zero-link/source':'.local/share/weixin-link/source')
 await mkdir(join(root,legacyManager?'src/wechat':'src/setup'),{recursive:true})
 await writeFile(join(root,'package.json'),' {"name":"weixin-link"}')
 await writeFile(join(root,legacyManager?'src/wechat/account-manager.mjs':'src/setup/account-manager.mjs'),`
 import {writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
 if(process.argv[2]==='list')console.log(JSON.stringify({accounts:[{account:${JSON.stringify(account)},ready:${ready},service_active:${running}}]}));
 else if(process.argv[2]==='stop'){if(${stopFails}){console.log(JSON.stringify({ok:false,error:${stopNumeric?'1':"'STOP_FAILED'"}}));process.exit(1)}writeFileSync(new URL('../../stopped',import.meta.url),'stopped');console.log(JSON.stringify({ok:true,status:'stopped'}))}
 else if(process.argv[2]==='refresh-qr'){
  writeFileSync(new URL('../../refreshed',import.meta.url),process.argv[3]);
  const path=fileURLToPath(new URL('../../login.png',import.meta.url));writeFileSync(path,'fixture');
  console.log(JSON.stringify({ok:true,status:'scan_to_login',path}));
 }else process.exit(2);
 `)
 return {home,root,env:{...process.env,HOME:home,WEIXIN_LINK_DIR:'',ZERO_LINK_DIR:'',WEIXIN_LINK_ACCOUNT:'',WEIXIN_LINK_RELOGIN:'',WEIXIN_LINK_QR_STYLE:'',SSH_CONNECTION:'fixture'}}
}
test('QR script refreshes a legacy JSON-only installation without leaking JSON',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{legacy:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('登录二维码已刷新'));assert(r.stdout.includes('login.png'))
 assert(!r.stdout.includes('"ok"'));assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
})
test('QR script can refresh an older installation with the original manager path',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{legacyManager:true})
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('登录二维码已刷新'))
 assert.equal(await readFile(join(f.root,'refreshed'),'utf8'),'default')
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
test('numeric child exit becomes an unconfirmed stop instead of an error code',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,{running:true,stopFails:true,stopNumeric:true})
 await assert.rejects(exec('sh',[script,'--relogin'],{env:f.env}),e=>e.stderr.includes('ACCOUNT_STOP_UNCONFIRMED'))
 assert(!(await readdir(f.root)).includes('refreshed'))
})
async function terminalFixture(t,{expired=false,mismatch=false,columns=80}={}){
 const f=await fixture(t),version='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 const stateDir=join(f.home,'.local/share/wechat-ping-bot')
 await mkdir(stateDir,{recursive:true})
 await writeFile(join(stateDir,'pairing.json'),JSON.stringify({status:'waiting_scan',qr_version:version,valid_until:expired?0:Date.now()+90000}))
 await writeFile(join(stateDir,'login-'+version+'.terminal'),'▀▄█ QR-FIXTURE █▄▀')
 const manager=join(f.root,'src/setup/account-manager.mjs')
 if(!mismatch)await writeFile(manager,(await readFile(manager,'utf8')).replace("../../login.png",'../../login-'+version+'.png'))
 const tty=join(f.home,'tty.cjs');await writeFile(tty,`process.stdout.isTTY=true;process.stdout.columns=${columns}`)
 f.env.NODE_OPTIONS=`--require=${JSON.stringify(tty)}`
 return f
}
test('SSH terminals show the matching QR code and retain a fallback PNG path',{skip:process.platform==='win32'},async t=>{
 const f=await terminalFixture(t)
 const r=await exec('sh',[script],{env:f.env})
 assert(r.stdout.includes('请直接用微信扫描'));assert(r.stdout.includes('▀▄█ QR-FIXTURE █▄▀'))
 assert(r.stdout.includes('备用 PNG'));assert(!r.stdout.includes('"ok"'))
})
test('expired and mismatched terminal QR codes are never printed',{skip:process.platform==='win32'},async t=>{
 for(const options of [{expired:true},{mismatch:true}]){
  const f=await terminalFixture(t,options),r=await exec('sh',[script],{env:f.env})
  assert(!r.stdout.includes('QR-FIXTURE'));assert(r.stdout.includes('二维码 PNG'))
 }
})
test('narrow terminals explain how to avoid wrapping the QR code',{skip:process.platform==='win32'},async t=>{
 const f=await terminalFixture(t,{columns:10}),r=await exec('sh',[script],{env:f.env})
 assert(!r.stdout.includes('QR-FIXTURE'));assert(r.stdout.includes('终端宽度不足'))
})

test('full mode preserves every QR module and draws spaces with solid backgrounds',{skip:process.platform==='win32'},async t=>{
 const f=await terminalFixture(t,{columns:200}),url='https://example.test/pair?fixture=qr-rendering'
 const code=QRCode.create(url),size=code.modules.size
 const terminal=await QRCode.toString(url,{type:'terminal',small:true})
 await writeFile(join(f.home,'.local/share/wechat-ping-bot/login-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.terminal'),terminal)
 const {stdout}=await exec('sh',[script],{env:{...f.env,WEIXIN_LINK_QR_STYLE:'full'}})
 assert(stdout.includes('完整色块模式'));assert(!/[▀▄█]/u.test(stdout))
 const rows=stdout.split('\n').filter(line=>line.includes('\x1b[48;2;')).map(line=>[...line.matchAll(/\x1b\[48;2;(255;255;255|0;0;0)m  /g)].map(match=>match[1]==='0;0;0'))
 assert.equal(rows[0].length,size+8);assert(rows.length>=size+8)
 for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y].length;x++){
  const expected=x>=4&&x<size+4&&y>=4&&y<size+4?Boolean(code.modules.data[(y-4)*size+x-4]):false
  assert.equal(rows[y][x],expected,`module ${x},${y}`)
 }
})
test('full mode reports required width instead of emitting a wrapped QR',{skip:process.platform==='win32'},async t=>{
 const f=await terminalFixture(t,{columns:40})
 await writeFile(join(f.home,'.local/share/wechat-ping-bot/login-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.terminal'),await QRCode.toString('fixture',{type:'terminal',small:true}))
 const {stdout}=await exec('sh',[script],{env:{...f.env,WEIXIN_LINK_QR_STYLE:'full'}})
 assert(stdout.includes('至少需要'));assert(!stdout.includes('\x1b[48;2;'))
})
