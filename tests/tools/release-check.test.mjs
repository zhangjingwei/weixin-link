import test from 'node:test'
import assert from 'node:assert/strict'
import {checkReleaseFile,checkIndex} from '../../src/tools/release-check.mjs'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
test('release refuses nested credentials, SSH keys and account state',()=>{
 for(const path of ['.ssh/config','config-templates/ha.json','workspace/.private/hosts.json','accounts/bot2/account.json','x/credentials.json','x/id_ed25519','x/backup-public.pem','x/state.sqlite-wal','x/.env.production','x/remote-hosts.json','x/integrations.json'])assert.ok(checkReleaseFile(path,Buffer.from('{}')).length,path)
 for(const path of ['accounts.mjs','config-templates/ha.example.json','config-templates/ssh-config.example','config-templates/backup.example.json'])assert.deepEqual(checkReleaseFile(path,Buffer.from('{}')),[],path)
 assert.deepEqual(checkReleaseFile('src/infrastructure/accounts/account-store.mjs',Buffer.from('export const example = true')),[])
  assert.deepEqual(checkReleaseFile('src/infrastructure/accounts/codex-home.mjs',Buffer.from('export const example = true')),[])
  assert.deepEqual(checkReleaseFile('src/infrastructure/accounts/provider-profile.mjs',Buffer.from('export const example = true')),[])
 assert.ok(checkReleaseFile('src/infrastructure/accounts/credentials.json',Buffer.from('{}')).some(issue=>issue.code==='PRIVATE_PATH'))
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

test('release archive includes the account store while excluding account state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-archive-'))
 try{
  execFileSync('git',['init','--quiet'],{cwd:dir})
  const attributes=fileURLToPath(new URL('../../.gitattributes',import.meta.url))
  writeFileSync(join(dir,'.gitattributes'),readFileSync(attributes))
  for(const path of ['src/infrastructure/accounts/account-store.mjs','src/infrastructure/accounts/credentials.json','other/accounts/private.json']){
   mkdirSync(join(dir,path,'..'),{recursive:true})
   writeFileSync(join(dir,path),'fixture')
  }
  execFileSync('git',['add','--force','.'],{cwd:dir})
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','fixture'],{cwd:dir})
  const archive=execFileSync('git',['archive','--format=tar','HEAD'],{cwd:dir})
  const paths=[]
  for(let offset=0;offset<archive.length;){
   const header=archive.subarray(offset,offset+512)
   if(!header[0])break
   paths.push(header.subarray(0,100).toString('utf8').split('\0')[0])
   const size=Number.parseInt(header.subarray(124,136).toString('ascii').trim(),8)
   offset+=512+Math.ceil(size/512)*512
  }
  assert.ok(paths.includes('src/infrastructure/accounts/account-store.mjs'))
  assert.ok(!paths.includes('src/infrastructure/accounts/credentials.json'))
  assert.ok(!paths.includes('other/accounts/private.json'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('release check rejects a staged account store excluded from the archive',()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-archive-check-'))
 try{
  execFileSync('git',['init','--quiet'],{cwd:dir})
  const path='src/infrastructure/accounts/account-store.mjs'
  mkdirSync(join(dir,'src/infrastructure/accounts'),{recursive:true})
  writeFileSync(join(dir,path),'export const fixture = true\n')
  writeFileSync(join(dir,'.gitattributes'),'**/accounts export-ignore\n')
  execFileSync('git',['add','--force','.'],{cwd:dir})
  assert.ok(checkIndex(dir).issues.some(issue=>issue.path===path&&issue.code==='ARCHIVE_MISSING_REQUIRED_FILE'))
  writeFileSync(join(dir,'.gitattributes'),'**/accounts/** export-ignore\n'+path+' -export-ignore\n')
  execFileSync('git',['add','.gitattributes'],{cwd:dir})
  assert.deepEqual(checkIndex(dir).issues,[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})
