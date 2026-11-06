import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile)
const {fileURLToPath}=await import('node:url')
const bootstrap=fileURLToPath(new URL('../../bootstrap.sh',import.meta.url))
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'weixin-link-bootstrap-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const bin=join(root,'bin'),source=join(root,'fixture'),dest=join(root,'source with spaces');await mkdir(bin);await mkdir(source)
 await writeFile(join(source,'install.sh'),'#!/bin/sh\nprintf installed > installed.txt\n')
 await writeFile(join(source,'package.json'),'{}\n');await writeFile(join(source,'.sample'),'included\n')
 const archive=join(root,'fixture.tar.gz');await exec('tar',['-czf',archive,'-C',source,'.'])
 // Fake only the download: tar, filesystem handling and installer invocation are real.
 await writeFile(join(bin,'launchctl'),'#!/bin/sh\nexit 113\n',{mode:0o755})
 await writeFile(join(bin,'systemctl'),'#!/bin/sh\nprintf \"LoadState=not-found\\nFragmentPath=\\n\"\n',{mode:0o755})
 await writeFile(join(bin,'curl'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then cp "$FIXTURE_ARCHIVE" "$2"; exit; fi; shift; done\nexit 2\n',{mode:0o755})
 return {root,source,dest,archive,env:{...process.env,WEIXIN_LINK_DIR:'',WEIXIN_LINK_REF:'',PATH:bin+':'+process.env.PATH,ZERO_LINK_DIR:dest,FIXTURE_ARCHIVE:archive}}
}
test('Unix bootstrap installs a downloaded archive into a persistent path including spaces',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await exec('bash',[bootstrap],{env:f.env})
 assert.equal(await readFile(join(f.dest,'installed.txt'),'utf8'),'installed')
 assert.equal(await readFile(join(f.dest,'.sample'),'utf8'),'included\n')
 assert.equal((await readdir(f.root)).some(n=>n.startsWith('.weixin-link-download.')),false)
})
test('Unix bootstrap refuses existing directories and symlinks without modifying them',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await mkdir(f.dest);await writeFile(join(f.dest,'keep'),'original')
 await assert.rejects(exec('bash',[bootstrap],{env:f.env}),/already exists/)
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
 const link=join(f.root,'link');await symlink(f.dest,link)
 await assert.rejects(exec('bash',[bootstrap],{env:{...f.env,ZERO_LINK_DIR:link}}),/already exists/)
})
test('Unix bootstrap does not create a destination after download failure',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await assert.rejects(exec('bash',[bootstrap],{env:{...f.env,FIXTURE_ARCHIVE:join(f.root,'missing')}}))
 assert.equal((await readdir(f.root)).includes('source with spaces'),false)
 assert.equal((await readdir(f.root)).some(n=>n.startsWith('.weixin-link-download.')),false)
})
test('Windows bootstrap uses real ZIP extraction and a harmless installer fixture',{skip:process.platform!=='win32'},async()=>{
 const script=new URL('./bootstrap-windows.ps1',import.meta.url)
 const {fileURLToPath}=await import('node:url')
 const result=await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(script)],{timeout:60000})
 assert(result.stdout.includes('WINDOWS_BOOTSTRAP_FIXTURES_OK'))
})
test('new bootstrap variables take precedence while legacy variables remain usable',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);const newDest=join(f.root,'preferred source')
 await exec('bash',[bootstrap],{env:{...f.env,WEIXIN_LINK_DIR:newDest,WEIXIN_LINK_REF:'main'}})
 assert.equal(await readFile(join(newDest,'installed.txt'),'utf8'),'installed')
 assert.equal((await readdir(f.root)).includes('source with spaces'),false)
})
test('renamed default does not create a parallel source tree beside an old default installation',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'.local/share/zero-link/source'),{recursive:true})
 await assert.rejects(exec('bash',[bootstrap],{env:{...f.env,HOME:f.root,ZERO_LINK_DIR:'',WEIXIN_LINK_DIR:''}}),/not a supported installation/)
 assert.equal((await readdir(join(f.root,'.local/share'))).includes('weixin-link'),false)
})
async function existingInstallation(f,{ready=false,running=false}={}){
 await mkdir(join(f.dest,'src/wechat'),{recursive:true});await mkdir(join(f.dest,'src/setup'),{recursive:true})
 await writeFile(join(f.dest,'package.json'),JSON.stringify({name:'weixin-link'}))
 await writeFile(join(f.dest,'keep'),'original')
 await writeFile(join(f.dest,'src/wechat/account-manager.mjs'),`import {writeFileSync} from 'node:fs';if(process.argv[2]==='list')console.log(JSON.stringify({accounts:[{account:'default',ready:${ready},service_active:${running}}]}));else if(process.argv[2]==='refresh-qr'){writeFileSync(new URL('../../refreshed',import.meta.url),'fresh');const path=new URL('../../login.png',import.meta.url);writeFileSync(path,'fixture');console.log(JSON.stringify({ok:true,status:'scan_to_login',path:(await import('node:url')).fileURLToPath(path)}))}else process.exit(2)`)
 await writeFile(join(f.dest,'src/setup/setup.mjs'),`import {writeFileSync} from 'node:fs';if(process.argv[2]!=='qr')process.exit(3);writeFileSync(new URL('../../displayed',import.meta.url),'qr');console.log('FRESH_QR_DISPLAYED')`)
}
test('repeating bootstrap refreshes an offline existing installation without downloading or reinstalling',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await existingInstallation(f)
 const r=await exec('bash',[bootstrap],{env:{...f.env,FIXTURE_ARCHIVE:join(f.root,'must-not-download')}})
 assert(r.stdout.includes('请用微信扫描 PNG 图片'));assert(!r.stdout.includes('\"ok\"'));assert(!r.stdout.includes('FRESH_QR_DISPLAYED'));assert.equal(await readFile(join(f.dest,'refreshed'),'utf8'),'fresh')
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original');assert.equal((await readdir(f.dest)).includes('installed.txt'),false)
})
test('repeating bootstrap leaves an online account running and does not refresh its QR',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await existingInstallation(f,{ready:true,running:true})
 const r=await exec('bash',[bootstrap],{env:f.env});assert(r.stdout.includes('微信已登录'))
 assert.equal((await readdir(f.dest)).includes('refreshed'),false)
})
test('running but unready accounts are not forcibly re-paired',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await existingInstallation(f,{running:true})
 await assert.rejects(exec('bash',[bootstrap],{env:f.env}),/service is running but not ready/)
 assert.equal((await readdir(f.dest)).includes('refreshed'),false)
})
test('recognized legacy default sources resume pairing in place',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);const dest=join(f.root,'.local/share/zero-link/source');await existingInstallation({...f,dest})
 const r=await exec('bash',[bootstrap],{env:{...f.env,HOME:f.root,ZERO_LINK_DIR:'',WEIXIN_LINK_DIR:''}})
 assert(r.stdout.includes('请用微信扫描 PNG 图片'));assert(!r.stdout.includes('\"ok\"'));assert(!r.stdout.includes('FRESH_QR_DISPLAYED'));assert.equal(await readFile(join(dest,'keep'),'utf8'),'original')
 assert.equal((await readdir(join(f.root,'.local/share'))).includes('weixin-link'),false)
})
test('existing installations also resume through a relative custom directory',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await existingInstallation(f)
 const r=await exec('bash',[bootstrap],{cwd:f.root,env:{...f.env,WEIXIN_LINK_DIR:'source with spaces'}})
 assert(r.stdout.includes('请用微信扫描 PNG 图片'));assert(!r.stdout.includes('\"ok\"'));assert(!r.stdout.includes('FRESH_QR_DISPLAYED'));assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
})
test('legacy installation opens its PNG on a Mac terminal without executing old QR rendering',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t);await existingInstallation(f)
 await writeFile(join(f.root,'bin/open'),'#!/bin/sh\nprintf "%s" "$1" > "$OPEN_CAPTURE"\n',{mode:0o755})
 const capture=join(f.root,'opened-path')
 const tty=join(f.root,'tty.cjs');await writeFile(tty,'process.stdout.isTTY=true')
 const r=await exec('bash',[bootstrap],{env:{...f.env,NODE_OPTIONS:`--require=${JSON.stringify(tty)}`,SSH_CONNECTION:'',SSH_CLIENT:'',SSH_TTY:'',OPEN_CAPTURE:capture}})
 assert.equal(await realpath(await readFile(capture,'utf8')),await realpath(join(f.dest,'login.png')))
 assert(r.stdout.includes('已打开二维码图片'))
 assert(!r.stdout.includes('"ok"'))
 assert.equal((await readdir(f.dest)).includes('displayed'),false)
})
test('legacy refresh failures retain a useful error code without dumping JSON',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await existingInstallation(f)
 const manager=join(f.dest,'src/wechat/account-manager.mjs')
 await writeFile(manager,(await readFile(manager,'utf8')).replace("writeFileSync(new URL('../../refreshed',import.meta.url),'fresh');", "console.log(JSON.stringify({ok:false,error:'QR_NOT_READY_RETRY'}));process.exit(1);"))
 await assert.rejects(exec('bash',[bootstrap],{env:f.env}),error=>{
  assert(error.stderr.includes('QR_NOT_READY_RETRY'))
  assert(!error.stderr.includes('"ok"'))
  assert(!error.stdout.includes('"ok"'))
  return true
 })
})
test('legacy Mac refresh retries error 113 without exposing JSON',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t);await existingInstallation(f)
 const manager=join(f.dest,'src/wechat/account-manager.mjs')
 const source=await readFile(manager,'utf8')
 await writeFile(manager,source.replace("writeFileSync(new URL('../../refreshed',import.meta.url),'fresh');", "const marker=new URL('../../first-attempt',import.meta.url);if(!(await import('node:fs')).existsSync(marker)){writeFileSync(marker,'attempted');console.log(JSON.stringify({ok:false,error:113}));process.exit(1)}writeFileSync(new URL('../../refreshed',import.meta.url),'fresh');"))
 const r=await exec('bash',[bootstrap],{env:f.env})
 assert(r.stdout.includes('正在重试'))
 assert(r.stdout.includes('请用微信扫描 PNG 图片'))
 assert(!r.stdout.includes('"ok"'))
})
test('registered Linux deployments are detected before download and dependency installation regardless of source layout',{skip:process.platform==='win32'},async t=>{
 for(const state of ['active','inactive','failed']){
  const f=await fixture(t)
  await writeFile(join(f.root,'bin/uname'),'#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo aarch64;; esac\n',{mode:0o755})
  await writeFile(join(f.root,'bin/systemctl'),`#!/bin/sh\nprintf 'LoadState=loaded\\nActiveState=${state}\\nFragmentPath=/custom/services/wechat-ping-bot.service\\n'\n`,{mode:0o755})
  const env={...f.env,FIXTURE_ARCHIVE:join(f.root,'must-not-download')}
  for(const script of [bootstrap,fileURLToPath(new URL('../../install.sh',import.meta.url))]){
   const result=await exec('bash',[script],{env})
   assert(result.stdout.includes('跳过重复安装'));assert(result.stdout.includes('ActiveState='+state))
  }
  assert(!(await readdir(f.root)).includes('source with spaces'))
 }
})
