import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec=promisify(execFile)
test('model menu accepts arrow keys and Enter',{skip:process.platform!=='darwin'},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'weixin-terminal-menu-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const script=join(directory,'choose.mjs')
 const moduleUrl=new URL('../../src/setup/terminal-wizard.mjs',import.meta.url).href
 await writeFile(script,`import {terminalChoice} from ${JSON.stringify(moduleUrl)}\nconsole.log('CHOICE=' + await terminalChoice('\\n模型接入\\n1. 订阅\\n2. DeepSeek\\n0. 稍后配置\\n请选择：'))\n`)
 const result=await exec('expect',['-c','spawn $env(NODE_EXE) $env(CHOOSE_SCRIPT)\nexpect "回车确认："\nsend "\\033\\[B\\r"\nexpect "CHOICE=2"\nexpect eof'],{env:{...process.env,NODE_EXE:process.execPath,CHOOSE_SCRIPT:script},timeout:30000})
 assert.match(result.stdout,/CHOICE=2/)
})
