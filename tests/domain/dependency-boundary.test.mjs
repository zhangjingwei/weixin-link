import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const domain=fileURLToPath(new URL('../../src/domain/',import.meta.url))

test('domain source never references a concrete agent backend',async()=>{
 const files=(await readdir(domain,{recursive:true})).filter(name=>name.endsWith('.mjs'))
 assert.ok(files.length>0)
 for(const name of files){
  const source=await readFile(join(domain,name),'utf8')
  assert.doesNotMatch(source,/(?:src\/base\/|(?:\.\.\/)+base\/)/,name)
 }
})

test('shared SessionManager has no static dependency on application, infrastructure or views',async()=>{
 const source=await readFile(fileURLToPath(new URL('../../src/base/codex/codex-session.mjs',import.meta.url)),'utf8')
 assert.doesNotMatch(source,/(?:from\s*|import\(\s*)['"](?:\.\.\/)+(?:application|infrastructure|interfaces)\//)
})
