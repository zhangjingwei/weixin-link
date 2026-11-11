import test from 'node:test'
import assert from 'node:assert/strict'
import {checkUpdates} from '../../../src/application/notifications/check-updates.mjs'
import {SetupController,setupCommand} from '../../../src/setup/setup-controller.mjs'
import {conversationInput} from '../../../src/interfaces/wechat/conversation-command.mjs'
const marker={version:1,repository:'zhangjingwei/weixin-link',ref:'v1.0.0',commit:'a'.repeat(40)}
const latest={tag:'v1.1.0',commit:'b'.repeat(40)}
const inspect=(installed=marker,release=latest,language='zh')=>checkUpdates({readInstalled:async()=>installed,fetchLatest:async()=>release,language})
test('explicit query reports versions and available update without scheduling anything',async()=>{
 const text=await inspect();assert.match(text,/当前版本：v1.0.0/);assert.match(text,/最新正式版：v1.1.0/);assert.match(text,/有可用更新/);assert.match(text,/本次检查未安排升级/)
 assert.match(await inspect({...marker,ref:'v1.1.0'}),/已是最新/)
 assert.match(await inspect({...marker,ref:'v2.0.0'}),/高于最新正式版/)
 assert.match(await inspect({...marker,ref:'main',commit:latest.commit.slice(0,7)}),/提交一致/)
})
test('unknown installation, absent release and invalid upstream do not fabricate an upgrade',async()=>{
 assert.match(await inspect(null),/未核实.*\n最新正式版.*\n.*无法判断/s)
 assert.match(await inspect(marker,null),/暂未发布正式版本/)
 assert.match(await inspect(marker,{...latest,tag:'v2.0.0-beta'}),/检查更新失败/)
 const result=await checkUpdates({readInstalled:async()=>marker,fetchLatest:async()=>{throw Error('private server details')}})
 assert.match(result,/检查更新失败/);assert.doesNotMatch(result,/private/)
 assert.match(await inspect(marker,latest,'en'),/Current version: v1.0.0/)
})
test('query command is exact, bypasses model setup and leaves interactive prompts pending',async()=>{
 assert.equal(setupCommand('检查更新'),'updates');assert.equal(setupCommand('CHECK-UPDATES'),'updatesEn')
 assert.equal(setupCommand('帮我检查更新'),null);assert.equal(setupCommand('/check-updates'),null)
 for(const text of ['检查更新','check-updates'])assert.equal(conversationInput(text,{pending:{target:'new'}}).promptResult,'keep')
 const calls=[],out=[],controller=new SetupController({stateDir:'/unused',checkUpdates:async language=>{calls.push(language);return 'version report'},runDoctor:async()=>{throw Error('must not check model')}})
 controller.busy=true
 await controller.handle('updates',async text=>out.push(text));await controller.handle('updatesEn',async text=>out.push(text))
 assert.deepEqual(calls,['zh','en']);assert.deepEqual(out,['version report','version report'])
})
