import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rename,rm,lstat,writeFile,readFile,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {managementPlugin} from '../../src/setup/management-plugin.mjs'

test('account-local skill installation is repeatable, removable and respects disabled setting',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zlm-install-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const options={root:resolve('.'),codexHome:join(dir,'codex'),stateDir:join(dir,'state')}
 assert.equal((await managementPlugin(options)).installed,true)
 const path=join(options.codexHome,'skills/managing-zerolink');assert.match(await readFile(join(path,'SKILL.md'),'utf8'),/name: managing-zerolink/)
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
 const options={root:resolve('.'),codexHome:join(dir,'codex'),stateDir:join(dir,'state')},path=join(options.codexHome,'skills/managing-zerolink')
 await mkdir(path,{recursive:true});await writeFile(join(path,'SKILL.md'),'private')
 await assert.rejects(managementPlugin(options),/PATH_CONFLICT/)
 assert.equal((await managementPlugin({...options,action:'remove'})).userFilesPreserved,true)
 assert.equal(await readFile(join(path,'SKILL.md'),'utf8'),'private')
 await rm(join(options.codexHome,'skills'),{recursive:true});await mkdir(join(dir,'unrelated'));await symlink(join(dir,'unrelated'),join(options.codexHome,'skills'),'dir')
 await assert.rejects(managementPlugin({...options,action:'install'}),/PATH_CONFLICT/)
})

test('upgrade replaces the managed legacy directory and preserves a user-edited legacy skill',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zlm-rename-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const options={root:resolve('.'),codexHome:join(dir,'codex'),stateDir:join(dir,'state')}
 const current=join(options.codexHome,'skills','managing-zerolink'),legacy=join(options.codexHome,'skills','zerolink-manage')
 await managementPlugin(options)
 await rename(current,legacy)
 await managementPlugin(options)
 await assert.rejects(lstat(legacy),{code:'ENOENT'})
 await rename(current,legacy)
 await writeFile(join(legacy,'SKILL.md'),'personal edits')
 await managementPlugin(options)
 assert.match(await readFile(join(current,'SKILL.md'),'utf8'),/^name: managing-zerolink$/m)
 assert.equal((await managementPlugin({...options,action:'remove'})).userFilesPreserved,true)
 assert.equal(await readFile(join(legacy,'SKILL.md'),'utf8'),'personal edits')
})
