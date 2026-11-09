import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,chmod,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec=promisify(execFile)

test('Unix install pairs through qr.sh using its own source directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'weixin-unix-install-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'custom-source'),bin=join(root,'bin'),log=join(root,'steps')
 await mkdir(join(source,'src/setup'),{recursive:true})
 await mkdir(bin)
 await copyFile(fileURLToPath(new URL('../../src/setup/unix-install.sh',import.meta.url)),join(source,'src/setup/unix-install.sh'))
 const scripts={
  uname:'#!/bin/sh\nif test "$1" = -s; then echo Darwin; else echo arm64; fi\n',
  launchctl:'#!/bin/sh\ncase "$2" in */com.wechat-assistant.wechat-ping-bot) exit 1;; esac\nexit 0\n',
  npm:'#!/bin/sh\nexit 0\n',
  node:'#!/bin/sh\nif test "$1" = -e; then exit 0; fi\nprintf "%s\\n" "$2" >> "$WEIXIN_TEST_LOG"\n',
 }
 for(const [name,content] of Object.entries(scripts)){
  const path=join(bin,name);await writeFile(path,content);await chmod(path,0o755)
 }
 const qr=join(source,'qr.sh')
 await writeFile(qr,'#!/bin/sh\nprintf "qr:%s\\n" "$WEIXIN_LINK_DIR" >> "$WEIXIN_TEST_LOG"\n')
 await chmod(qr,0o755)
 await exec('/bin/sh',[join(source,'src/setup/unix-install.sh')],{
  env:{...process.env,HOME:root,PATH:`${bin}:${process.env.PATH}`,WEIXIN_TEST_LOG:log,WEIXIN_LINK_DIR:''},
 })
 assert.deepEqual((await readFile(log,'utf8')).trim().split('\n'),[
  'init','deps','services',`qr:${source}`,
 ])
})
