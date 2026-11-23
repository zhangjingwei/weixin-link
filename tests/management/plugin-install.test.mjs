import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readlink,rm,lstat,writeFile,readFile,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {managementPlugin} from '../../src/setup/management-plugin.mjs'

test('account-local skill installation is repeatable, removable and respects disabled setting',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zlm-install-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const options={root:resolve('.'),codexHome:join(dir,'codex'),stateDir:join(dir,'state')}
 assert.equal((await managementPlugin(options)).installed,true)
 const path=join(options.codexHome,'skills/zerolink-manage');assert.match(await readFile(join(path,'SKILL.md'),'utf8'),/name: zerolink-manage/)
 assert.equal((await managementPlugin(options)).enabled,true)
 await writeFile(join(options.codexHome,'config.toml'),'# unrelated settings\n')
 await managementPlugin({...options,action:'remove'})
 await assert.rejects(lstat(path),{code:'ENOENT'})
 assert.equal((await managementPlugin(options)).installed,false)
 assert.equal(await readFile(join(options.codexHome,'config.toml'),'utf8'),'# unrelated settings\n')
 assert.equal((await managementPlugin({...options,action:'install'})).installed,true)
})
test('install/remove never overwrite a user skill or write through a skills symlink',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zlm-conflict-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const options={root:resolve('.'),codexHome:join(dir,'codex'),stateDir:join(dir,'state')},path=join(options.codexHome,'skills/zerolink-manage')
 await mkdir(path,{recursive:true});await writeFile(join(path,'SKILL.md'),'private')
 await assert.rejects(managementPlugin(options),/PATH_CONFLICT/)
 assert.equal((await managementPlugin({...options,action:'remove'})).userFilesPreserved,true)
 assert.equal(await readFile(join(path,'SKILL.md'),'utf8'),'private')
 await rm(join(options.codexHome,'skills'),{recursive:true});await mkdir(join(dir,'unrelated'));await symlink(join(dir,'unrelated'),join(options.codexHome,'skills'),'dir')
 await assert.rejects(managementPlugin({...options,action:'install'}),/PATH_CONFLICT/)
})
