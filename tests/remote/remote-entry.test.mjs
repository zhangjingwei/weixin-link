import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const repository=fileURLToPath(new URL('../../',import.meta.url))
test('remote CLI keeps state in the explicit workspace without connecting a host',()=>{
 const entry='src/interfaces/cli/remote-cli.mjs'
 const root=mkdtempSync(join(tmpdir(),'remote-entry-')),config=join(root,'hosts.json')
 try{
  writeFileSync(config,'{}')
  const env={...process.env,WECHAT_REMOTE_WORKSPACE:root,WECHAT_REMOTE_HOSTS:config,WECHAT_BOT_ROOT:repository,CODEX_THREAD_ID:'entry-test'}
  const text=execFileSync(process.execPath,[join(repository,entry)],{input:JSON.stringify({action:'stop-scope'}),env,encoding:'utf8'})
  const result=JSON.parse(text);assert.equal(result.ok,true);assert.equal(result.result?.stop_confirmed??result.stop_confirmed,true)
  assert.ok(existsSync(join(root,'remote-sessions.json')))
  assert.ok(JSON.parse(readFileSync(join(root,'remote-sessions.json'),'utf8'))._cancelled)
 }finally{rmSync(root,{recursive:true,force:true})}
})
