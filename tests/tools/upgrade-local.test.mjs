import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {previewLocal} from '../../src/tools/upgrade-local.mjs'

test('local upgrade uses the reviewed index and cleans up after a failed upgrade', async t=>{
  const root=await mkdtemp(join(tmpdir(),'weixin-preview-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const git=args=>execFileSync('git',args,{cwd:root})
  git(['init','-q'])
  await writeFile(join(root,'feature.mjs'),'staged')
  git(['add','feature.mjs'])
  await writeFile(join(root,'feature.mjs'),'later edit')
  await writeFile(join(root,'.env'),'private fixture')
  const target=join(root,'test-install')
  let sourcePath
  const upgrade=async({source,target:actual})=>{
    sourcePath=source
    assert.equal(actual,target)
    assert.equal(await readFile(join(source,'feature.mjs'),'utf8'),'staged')
    for(const name of ['.git','.env']) assert.equal(existsSync(join(source,name)),false)
    throw Error('simulated busy service')
  }
  await previewLocal({root,target,checkOnly:true,upgrade})
  assert.equal(sourcePath,undefined)
  await assert.rejects(previewLocal({root,target,upgrade}),/simulated busy service/)
  assert.equal(existsSync(sourcePath),false)
  assert.equal(await readFile(join(root,'feature.mjs'),'utf8'),'later edit')
})

test('pending installation installs the confirmed snapshot without a second upgrade', {skip:process.platform==='win32'},async t=>{
  const root=await mkdtemp(join(tmpdir(),'weixin-pending-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  execFileSync('git',['init','-q'],{cwd:root})
  await writeFile(join(root,'.weixin-link-install-pending'),'')
  const events=[]
  const options={root,target:root,inspect:async()=>{throw Error('UPGRADE_SERVICE_NOT_INSTALLED')},
    resume:async(_root,_target,archive)=>{assert(existsSync(archive));events.push('resume')},upgrade:async()=>events.push('upgrade')}
  await previewLocal({...options,checkOnly:true})
  await previewLocal({...options,confirm:async()=>false})
  assert.deepEqual(events,[])
  await previewLocal({...options,confirm:async()=>true})
  assert.deepEqual(events,['resume'])
  await assert.rejects(previewLocal({...options,resume:async()=>{throw Error('setup failed')}}),/setup failed/)
  assert.deepEqual(events,['resume'])
})
