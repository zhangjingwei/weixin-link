import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
test('Unix release installer checks package version before installing and records tag',{skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'release-install-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const bin=join(root,'bin'),archiveRoot=join(root,'zhangjingwei-weixin-link-abcdef0')
 await mkdir(bin);await mkdir(join(archiveRoot,'src/setup'),{recursive:true})
 await writeFile(join(archiveRoot,'package.json'),JSON.stringify({name:'weixin-link',version:'1.2.0'},null,2))
 await writeFile(join(archiveRoot,'src/setup/unix-install.sh'),'#!/bin/sh\nexit 0\n')
 const archive=join(root,'fixture.tar.gz');execFileSync('tar',['-czf',archive,'-C',root,'zhangjingwei-weixin-link-abcdef0'])
 await writeFile(join(bin,'uname'),'#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n',{mode:0o700})
 await writeFile(join(bin,'systemctl'),'#!/bin/sh\nexit 0\n',{mode:0o700})
 await writeFile(join(bin,'curl'),'#!/bin/sh\nfor arg do last="$arg"; done\ncp "$TEST_ARCHIVE" "$last"\n',{mode:0o700})
 const dest=join(root,'installed'),env={...process.env,PATH:bin+':'+process.env.PATH,WEIXIN_LINK_DIR:dest,WEIXIN_LINK_REF:'v1.2.0',WEIXIN_LINK_EXPECTED_COMMIT:'',TEST_ARCHIVE:archive}
 execFileSync('/bin/sh',[resolve('install.sh')],{env,stdio:'pipe'})
 const marker=JSON.parse(await readFile(join(dest,'.weixin-link-release.json'),'utf8'));assert.equal(marker.ref,'v1.2.0');assert.equal(marker.commit,'abcdef0')
 assert.throws(()=>execFileSync('/bin/sh',[resolve('install.sh')],{env:{...env,WEIXIN_LINK_DIR:join(root,'mismatch'),WEIXIN_LINK_REF:'v1.3.0'},stdio:'pipe'}),e=>String(e.stderr).includes('Release tag and package version differ'))
})
