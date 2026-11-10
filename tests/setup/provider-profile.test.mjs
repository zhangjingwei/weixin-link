import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {saveProviderProfile,clearProviderProfile,readProviderProfile,providerEnvironment} from '../../src/setup/provider-profile.mjs'
import {accountPaths} from '../../src/infrastructure/accounts/account-store.mjs'
import {codexProviderOptions} from '../../src/base/codex/provider-options.mjs'

test('DeepSeek profile is account private and generates Responses options without exposing its key',async t=>{
 const home=await mkdtemp(join(tmpdir(),'provider-profile-'));t.after(()=>rm(home,{recursive:true,force:true}))
 await saveProviderProfile({kind:'deepseek',apiKey:'sk-test-private-key',home})
 const path=join(accountPaths('default',home).stateDir,'codex-provider.json'),profile=await readProviderProfile(accountPaths('default',home).stateDir)
 assert.equal((await stat(path)).mode&0o077,0)
 const {options,secrets}=providerEnvironment(profile,{}),config=codexProviderOptions({...options,...secrets})
 assert(config.args.join(' ').includes('wire_api="responses"'))
 assert(!config.args.join(' ').includes('sk-test-private-key'))
 assert.equal(secrets.WECHAT_DEEPSEEK_API_KEY,'sk-test-private-key')
 assert.equal((await readFile(path,'utf8')).includes('sk-test-private-key'),true)
 await clearProviderProfile({home});assert.equal(await readProviderProfile(accountPaths('default',home).stateDir),null)
})
test('Qwen uses the official Beijing workspace Responses endpoint',async t=>{
 const home=await mkdtemp(join(tmpdir(),'provider-profile-'));t.after(()=>rm(home,{recursive:true,force:true}))
 await saveProviderProfile({kind:'qwen',workspaceId:'ws12345',apiKey:'sk-test-private-key',home})
 const profile=await readProviderProfile(accountPaths('default',home).stateDir),{options}=providerEnvironment(profile,{})
 assert.equal(options.WECHAT_CODEX_BASE_URL,'https://ws12345.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
 assert.equal(options.WECHAT_CODEX_MODEL,'qwen3.7-max')
 await assert.rejects(saveProviderProfile({kind:'qwen',workspaceId:'bad/path',apiKey:'sk-test-private-key',home}),/INVALID_QWEN_WORKSPACE_ID/)
})
