import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
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
 await assert.rejects(exec('bash',[bootstrap],{env:{...f.env,HOME:f.root,ZERO_LINK_DIR:'',WEIXIN_LINK_DIR:''}}),/earlier installation exists/)
 assert.equal((await readdir(join(f.root,'.local/share'))).includes('weixin-link'),false)
})
