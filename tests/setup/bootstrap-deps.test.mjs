import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec=promisify(execFile)
test('dependencies install before modules that require npm packages are loaded',async t=>{
 const root=await mkdtemp(join(tmpdir(),'weixin-bootstrap-deps-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const setup=join(root,'src/setup')
 await mkdir(setup,{recursive:true})
 for(const file of ['setup.mjs','cli-output.mjs','setup-locale.mjs','platform-command.mjs'])await copyFile(new URL(`../../src/setup/${file}`,import.meta.url),join(setup,file))
 await writeFile(join(root,'package.json'),'{"name":"bootstrap-fixture","version":"1.0.0"}')
 await writeFile(join(root,'package-lock.json'),'{"name":"bootstrap-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"bootstrap-fixture","version":"1.0.0"}}}')
 const result=await exec(process.execPath,[join(setup,'setup.mjs'),'deps','--human'],{env:{...process.env,npm_config_offline:'true'},timeout:60000})
 assert.match(result.stdout,/依赖安装完成/)
})
