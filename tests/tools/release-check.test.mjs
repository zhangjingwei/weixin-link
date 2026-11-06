import test from 'node:test'
import assert from 'node:assert/strict'
import {checkReleaseFile,checkIndex} from '../../src/tools/release-check.mjs'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
test('release refuses nested credentials, SSH keys and account state',()=>{
 for(const path of ['.ssh/config','config-templates/ha.json','workspace/.private/hosts.json','accounts/bot2/account.json','x/credentials.json','x/id_ed25519','x/backup-public.pem','x/state.sqlite-wal','x/.env.production','x/remote-hosts.json'])assert.ok(checkReleaseFile(path,Buffer.from('{}')).length,path)
 for(const path of ['accounts.mjs','config-templates/ha.example.json','config-templates/ssh-config.example','config-templates/backup.example.json'])assert.deepEqual(checkReleaseFile(path,Buffer.from('{}')),[],path)
})
test('force-added secrets are rejected without exposing their values',()=>{
 const samples=['-----BEGIN '+'OPENSSH PRIVATE KEY-----','sk-'+'A'.repeat(32),'eyJ'+'a'.repeat(24)+'.'+'b'.repeat(24)+'.'+'c'.repeat(24),'token: "'+'d'.repeat(40)+'"']
 for(const secret of samples){const issues=checkReleaseFile('source.mjs',Buffer.from(secret));assert.ok(issues.length);assert.ok(!JSON.stringify(issues).includes(secret))}
 assert.equal(checkReleaseFile('source.mjs',Buffer.from('target'),'120000')[0].code,'SYMLINK_NOT_ALLOWED_IN_RELEASE')
})

test('index check catches a forced secret even after the working copy is cleaned',()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-index-'))
 try{
  execFileSync('git',['init','--quiet'],{cwd:dir});mkdirSync(join(dir,'config-templates'))
  const path=join(dir,'config-templates','ha.json');writeFileSync(path,JSON.stringify({token:'x'.repeat(40)}))
  execFileSync('git',['add','--force','config-templates/ha.json'],{cwd:dir});writeFileSync(path,'{}')
  const result=checkIndex(dir);assert.equal(result.checked,1);assert.ok(result.issues.some(i=>i.code==='PRIVATE_PATH'));assert.ok(result.issues.some(i=>i.code==='LONG_SECRET_LITERAL'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
