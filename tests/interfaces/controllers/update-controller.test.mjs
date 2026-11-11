import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUpdateController} from '../../../src/interfaces/controllers/update-controller.mjs'

test('update controller sends a newer release through the presenter once', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'update-controller-'))
  t.after(() => rm(stateDir, {recursive: true, force: true}))
  await writeFile(join(stateDir, '.weixin-link-release.json'), JSON.stringify({version: 1, repository: 'zhangjingwei/weixin-link', ref: 'v1.0.0', commit: 'a'.repeat(7)}))
  const notices = [], ready = () => true
  const controller = createUpdateController({
    stateDir, sourceDir: stateDir, owners: ['alice'], ready,
    fetchLatest: async () => ({tag: 'v1.1.0', commit: 'b'.repeat(40)}),
    view: {notice: async (...args) => {notices.push(args); return {status: 'accepted'}}}, log: () => {},
  })
  await controller.tick()
  await controller.tick()
  assert.equal(notices.length, 1)
  assert.equal(notices[0][0], 'alice')
  assert.equal(notices[0][2].current, ready)
  assert.match(notices[0][1], /不会自动升级/)
  controller.close()
})

test('explicit checks run while busy, repeat on request and do not consume automatic notice state',async t=>{
 const root=await mkdtemp(join(tmpdir(),'explicit-update-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await writeFile(join(root,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'v1.0.0',commit:'a'.repeat(40)}))
 let ready=false,requests=0,sends=0
 const controller=createUpdateController({stateDir:root,sourceDir:root,owners:['alice'],ready:()=>ready,fetchLatest:async()=>{requests++;return {tag:'v1.1.0',commit:'b'.repeat(40)}},view:{notice:async()=>{sends++;return {status:'accepted'}}},log:()=>{}})
 assert.match(await controller.check(),/有可用更新/);assert.match(await controller.check('en'),/An update is available/)
 assert.equal(requests,2);assert.equal(sends,0)
 ready=true;await controller.tick();assert.equal(sends,1)
 assert.match(await controller.check(),/有可用更新/)
 await controller.tick();assert.equal(sends,1)
 controller.close()
})
