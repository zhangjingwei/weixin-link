import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'

const exec=promisify(execFile)
const bootstrap=fileURLToPath(new URL('../../install.sh',import.meta.url))
test('Windows PowerShell entry installs and upgrades with one command',{skip:process.platform!=='win32'},async()=>{
 const script=fileURLToPath(new URL('./install-windows.ps1',import.meta.url))
 const result=await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{timeout:60000})
 assert.match(result.stdout,/WINDOWS_INSTALL_FIXTURES_OK/)
})
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'weixin-bootstrap-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const bin=join(root,'bin'),source=join(root,'zhangjingwei-weixin-link-abc1234'),dest=join(root,'source with spaces')
 await mkdir(bin);await mkdir(join(source,'src/setup'),{recursive:true})
 await writeFile(join(source,'src/setup/unix-install.sh'),'#!/bin/sh\nprintf installed > installed.txt\n')
 await writeFile(join(source,'package.json'),'{"name":"weixin-link"}\n')
 await writeFile(join(source,'src/setup/upgrade.mjs'),'// fixture\n')
 const archive=join(root,'fixture.tar.gz')
 await exec('tar',['-czf',archive,'-C',root,'zhangjingwei-weixin-link-abc1234'])
 await writeFile(join(bin,'curl'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then cp "$FIXTURE_ARCHIVE" "$2"; exit; fi; shift; done\nexit 2\n',{mode:0o755})
 await writeFile(join(bin,'launchctl'),'#!/bin/sh\nexit 113\n',{mode:0o755})
 await writeFile(join(bin,'systemctl'),'#!/bin/sh\nprintf "FragmentPath=\\n"\n',{mode:0o755})
 return {root,bin,source,dest,archive,env:{...process.env,HOME:root,WEIXIN_LINK_DIR:dest,WEIXIN_LINK_REF:'main',PATH:bin+':'+process.env.PATH,FIXTURE_ARCHIVE:archive}}
}
async function installed(f,{legacyManager=false}={}){
 await mkdir(join(f.dest,'src/wechat'),{recursive:true})
 await mkdir(join(f.dest,'src/setup'),{recursive:true})
 await writeFile(join(f.dest,'package.json'),'{"name":"weixin-link"}\n')
 await writeFile(join(f.dest,legacyManager?'src/wechat/account-manager.mjs':'src/setup/account-manager.mjs'),'// fixture\n')
 await writeFile(join(f.dest,'src/setup/setup.mjs'),'// fixture\n')
 await writeFile(join(f.dest,'keep'),'original')
 const node=join(f.bin,'node')
 await writeFile(node,'#!/bin/sh\ncase "$1" in -e) exit 0;; esac\nprintf "%s" "$2" > "$UPGRADE_CAPTURE"\n',{mode:0o755})
 return {...f.env,UPGRADE_CAPTURE:join(f.root,'upgrade-target')}
}
test('one POSIX shell entry installs a fresh source tree',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t)
 await exec('sh',['-c','cat "$BOOTSTRAP_SCRIPT" | sh'],{env:{...f.env,BOOTSTRAP_SCRIPT:bootstrap}})
 assert.equal(await readFile(join(f.dest,'installed.txt'),'utf8'),'installed')
 assert.deepEqual(JSON.parse(await readFile(join(f.dest,'.weixin-link-release.json'),'utf8')),{version:1,repository:'zhangjingwei/weixin-link',ref:'main',commit:'abc1234'})
 assert.equal((await readdir(f.root)).some(name=>name.startsWith('.weixin-link-download.')),false)
})
test('same entry routes an existing installation to upgrade without running install',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),env=await installed(f)
 const result=await exec('sh',[bootstrap],{env})
 assert.match(result.stdout,/正在检查已安装服务/)
 assert.equal(await readFile(env.UPGRADE_CAPTURE,'utf8'),f.dest)
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
 assert.equal((await readdir(f.dest)).includes('installed.txt'),false)
})
test('existing installation menu handles local maintenance without downloading an upgrade',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t),env=await installed(f)
 await writeFile(join(f.bin,'node'),'#!/bin/sh\nif [ "$1" = -e ]; then exit 0; fi\nprintf "%s\\n" "$*" > "$UPGRADE_CAPTURE"\n',{mode:0o755})
 for(const [choice,expected]of [['2','wizard default --human'],['3','wechat-login --relogin default --human'],['4','wechat-login bot2 --human']]){
  const script=`spawn sh $env(BOOTSTRAP_SCRIPT)\nexpect "回车确认："\nsend "${choice}\\r"\n${choice==='4'?'expect "新账号名称*"\nsend "bot2\\r"\n':''}expect eof`
  await exec('expect',['-c',script],{env:{...env,BOOTSTRAP_SCRIPT:bootstrap}})
  assert((await readFile(env.UPGRADE_CAPTURE,'utf8')).includes(expected))
 }
 await exec('expect',['-c','spawn sh -c {cat "$BOOTSTRAP_SCRIPT" | sh}\nexpect "回车确认："\nsend "\\033\\[B\\r"\nexpect eof'],{env:{...env,BOOTSTRAP_SCRIPT:bootstrap}})
 assert((await readFile(env.UPGRADE_CAPTURE,'utf8')).includes('wizard default --human'))
 assert.equal((await readdir(f.root)).some(name=>name.startsWith('.weixin-link-download.')),false)
 await writeFile(join(f.dest,'src/setup/uninstall.mjs'),'// fixture\n')
 await exec('expect',['-c','spawn sh $env(BOOTSTRAP_SCRIPT)\nexpect "回车确认："\nsend "5\\r"\nexpect "卸载程序？"\nsend "\\r"\nexpect eof'],{env:{...env,BOOTSTRAP_SCRIPT:bootstrap}})
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
 await exec('expect',['-c','spawn sh $env(BOOTSTRAP_SCRIPT)\nexpect "回车确认："\nsend "5\\r"\nexpect "卸载程序？"\nsend "\\033\\[B\\r"\nexpect eof'],{env:{...env,BOOTSTRAP_SCRIPT:bootstrap}})
 assert((await readFile(env.UPGRADE_CAPTURE,'utf8')).includes('uninstall.mjs'))
 await assert.rejects(readFile(join(f.dest,'keep')),{code:'ENOENT'})
})
test('piped entry keeps noninteractive upgrade behavior',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),env=await installed(f)
 await exec('sh',['-c','cat "$BOOTSTRAP_SCRIPT" | sh'],{env:{...env,BOOTSTRAP_SCRIPT:bootstrap}})
 assert.equal(await readFile(env.UPGRADE_CAPTURE,'utf8'),f.dest)
 await assert.rejects(exec('sh',[bootstrap,'login'],{env}),/Usage: sh install.sh/)
})
test('older manager path remains eligible for in-place upgrade',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),env=await installed(f,{legacyManager:true})
 await exec('sh',[bootstrap],{env})
 assert.equal(await readFile(env.UPGRADE_CAPTURE,'utf8'),f.dest)
})
test('unsupported existing directory and symlink are never overwritten',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await mkdir(f.dest);await writeFile(join(f.dest,'keep'),'original')
 await assert.rejects(exec('sh',[bootstrap],{env:f.env}),/not a supported installation/)
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
 const link=join(f.root,'link');await symlink(f.dest,link)
 await assert.rejects(exec('sh',[bootstrap],{env:{...f.env,WEIXIN_LINK_DIR:link}}),/not a supported installation/)
})
test('registered service without selected source blocks a parallel installation',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t)
 await writeFile(join(f.bin,'uname'),'#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n',{mode:0o755})
 await writeFile(join(f.bin,'systemctl'),'#!/bin/sh\nprintf "FragmentPath=/custom/service\\n"\n',{mode:0o755})
 await assert.rejects(exec('sh',[bootstrap],{env:f.env}),/WEIXIN_LINK_DIR/)
 assert.equal((await readdir(f.root)).includes('source with spaces'),false)
})
test('download failure leaves existing source untouched',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),env=await installed(f)
 await assert.rejects(exec('sh',[bootstrap],{env:{...env,FIXTURE_ARCHIVE:join(f.root,'missing')}}))
 assert.equal(await readFile(join(f.dest,'keep'),'utf8'),'original')
 assert.equal((await readdir(f.root)).some(name=>name.startsWith('.weixin-link-download.')),false)
})
