import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initInstallation,installServices,doctor,unitText,installCodex,codexAvailability} from '../../src/setup/setup-core.mjs'
import {accountCodexHome,ensureAccountCodexHome} from '../../src/infrastructure/accounts/codex-home.mjs'
import {findCodex} from '../../src/setup/install-config.mjs'
import {parseDeviceLogin} from '../../src/setup/setup-login.mjs'
import {SetupController,setupCommand} from '../../src/setup/setup-controller.mjs'
const fixture=async t=>{const home=await mkdtemp(join(tmpdir(),'wechat-onboard-'));t.after(()=>rm(home,{recursive:true,force:true}));return home}
test('fresh installation works without Codex, owners, credentials or npm SDK',async t=>{const home=await fixture(t),root=join(home,'source');await mkdir(root);const r=await initInstallation({home,root});assert(r.initialized);assert((await readFile(join(r.workspace,'AGENTS.md'),'utf8')).includes('原生记忆'));const state=join(home,'.local/share/wechat-ping-bot');assert.deepEqual(await readdir(state),['installation.json']);assert.equal((await initInstallation({home,root})).initialized,true);await assert.rejects(initInstallation({home,root,workspace:join(home,'other')}),/ALREADY_CONFIGURED/)})
test('service installation prepares both templates and never starts or overrides foreign services',async t=>{const home=await fixture(t),root=join(home,'source with spaces'),calls=[];const run=async(...a)=>{calls.push(a)};await installServices({home,root,run,platform:'linux'});assert.deepEqual(calls[0][1],['--user','daemon-reload']);assert(!calls.some(c=>c[1].includes('start')));const dir=join(home,'.config/systemd/user');const text=await readFile(join(dir,'wechat-ping-bot@.service'),'utf8');assert(text.includes('WECHAT_ACCOUNT=%i'));assert(text.includes('/src/wechat/bot.mjs'));assert(text.includes('source with spaces'));await writeFile(join(dir,'wechat-ping-bot.service'),'foreign service');await assert.rejects(installServices({home,root,run,platform:'linux'}),/REQUIRES_REVIEW/);assert.equal(await readFile(join(dir,'wechat-ping-bot.service'),'utf8'),'foreign service')})
test('doctor separates a working channel from missing Codex and does not expose command output',async t=>{const home=await fixture(t),root=join(home,'source');await mkdir(join(root,'node_modules/wechatbot-zerolink/dist/messaging'),{recursive:true});await writeFile(join(root,'node_modules/wechatbot-zerolink/dist/index.js'),'');await writeFile(join(root,'node_modules/wechatbot-zerolink/package.json'),JSON.stringify({name:'wechatbot-zerolink',version:'2.2.0-zerolink.2'}));await writeFile(join(root,'node_modules/wechatbot-zerolink/dist/messaging/poller.js'),'beforeCheckpoint');await initInstallation({home,root});await installServices({home,root,reload:false});const r=await doctor({home,root,run:async(bin)=>{if(bin.endsWith('codex'))throw Error('secret failure');return {stdout:'secret'}}});assert.equal(r.codexInstalled,false);assert.equal(r.codexLoggedIn,false);assert.equal(r.channelPrerequisitesReady,true);assert(!JSON.stringify(r).includes('secret'))})
test('bundled Codex runtime is resolved from the source tree, never the user PATH',async t=>{
 const home=await fixture(t),root=join(home,'source'),binary=findCodex(home,{root}),calls=[]
 assert(binary.startsWith(join(root,'node_modules','@openai')))
 await assert.rejects(installCodex({home,root,run:async()=>{throw Error('must not run')}}),/CODEX_BUNDLED_RUNTIME_MISSING/)
 await mkdir(join(binary,'..'),{recursive:true});await writeFile(binary,'fixture')
 const r=await installCodex({home,root,run:async(bin,args)=>{calls.push([bin,args]);return {stdout:'codex-cli 0.163.0\n'}}})
 assert.equal(r.status,'bundled');assert.equal(calls[0][0],binary)
 assert(!calls.some(c=>c[0]==='npm'))
})
test('login status uses the selected account home and ignores an inherited Codex home',async t=>{
 const home=await fixture(t),root=join(home,'source'),binary=findCodex(home,{root}),calls=[]
 await mkdir(join(binary,'..'),{recursive:true});await writeFile(binary,'fixture')
 const original=process.env.CODEX_HOME;process.env.CODEX_HOME=join(home,'personal-codex')
 try{
  for(const accountId of ['default','work'])await codexAvailability({home,root,accountId,run:async(_binary,args,options)=>{calls.push({args,options});return {stdout:'codex-cli 0.163.0\n'}}})
 }finally{if(original===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=original}
 const checks=calls.filter(call=>call.args[0]==='login')
 assert.deepEqual(checks.map(call=>call.options.env.CODEX_HOME),[accountCodexHome('default',home),accountCodexHome('work',home)])
 assert.notEqual(checks[0].options.env.CODEX_HOME,checks[1].options.env.CODEX_HOME)
 const linked=accountCodexHome('linked',home);await mkdir(join(linked,'..'),{recursive:true});await symlink(join(home,'personal-codex'),linked)
 await assert.rejects(ensureAccountCodexHome('linked',home),/INVALID_CODEX_HOME/)
})
test('doctor reports custom provider access without requiring subscription login',async t=>{
 const home=await fixture(t),root=join(home,'source'),binary=findCodex(home,{root}),calls=[]
 await mkdir(join(binary,'..'),{recursive:true});await writeFile(binary,'fixture')
 const providerEnv={WECHAT_CODEX_PROVIDER:'custom',WECHAT_CODEX_BASE_URL:'https://provider.example.com',WECHAT_CODEX_API_KEY_ENV:'PRIVATE_MODEL_KEY',PRIVATE_MODEL_KEY:'test-only'}
 const r=await doctor({home,root,providerEnv,run:async(bin,args)=>{calls.push(args);return {stdout:bin===binary?'codex-cli 0.163.0\n':'ok'}}})
 assert.equal(r.codexInstalled,true)
 assert.equal(r.codexLoggedIn,false)
 assert.equal(r.codexAccessReady,true)
 assert.equal(r.authMode,'provider')
 assert(r.checks.some(c=>c.name==='codexProviderKey'&&c.ok))
 assert(!calls.some(args=>args[0]==='login'))
})
test('direct Codex acceptance requires a completed inference probe',async t=>{
 const home=await fixture(t),out=[],calls=[]
 const controller=await new SetupController({home,stateDir:join(home,'state'),accountId:'default',runCheck:async()=>{calls.push('protocol')},runModelTest:async({executionKey})=>{calls.push(executionKey);return {status:'completed',reply:'连接成功'}}}).init()
 await controller.handle('check',text=>out.push(text),{scope:'owner',executionKey:'conversation-1'})
 assert.deepEqual(calls,['protocol','conversation-1'])
 assert(out.at(-1).includes('模型推理验收通过'))
})
test('exact WeChat setup controls route independently of model and sensitive login output is filtered',async t=>{const home=await fixture(t),out=[];assert.equal(setupCommand('安装智能体'),'install');assert.equal(setupCommand('安装Codex'),null);assert.equal(setupCommand('请介绍安装Codex'),null);assert.equal(parseDeviceLogin('token=secret https://evil.invalid/device ABCD-EFGHI'),null);assert.deepEqual(parseDeviceLogin('https://auth.openai.com/codex/device\nABCD-EFGHI'),{url:'https://auth.openai.com/codex/device',code:'ABCD-EFGHI'});const c=await new SetupController({home,stateDir:join(home,'state'),runDoctor:async()=>({checks:[{name:'codexInstalled',ok:false,action:'安装Codex'}]})}).init();await c.handle('status',s=>out.push(s));assert(out[0].includes('安装Codex'));assert.equal(c.busy,false)})
test('fresh default pairing records the scanner without depending on Codex',async t=>{const home=await fixture(t);await initInstallation({home});const {registerLogin,accountPaths}=await import('../../src/infrastructure/accounts/account-store.mjs');await registerLogin('default',{accountId:'fresh-bot',userId:'scanner',token:'test-only'},home);const state=accountPaths('default',home).stateDir;assert.deepEqual(JSON.parse(await readFile(join(state,'codex-owners.json'),'utf8')),['scanner']);assert.equal(JSON.parse(await readFile(join(state,'account-identity.json'),'utf8')).accountId,'fresh-bot')})
test('services use private Node and propagate its directory for npm and env-node scripts',()=>{const s=unitText({root:'/tmp/project',node:'/tmp/private-node/bin/node',home:'/tmp/user'});assert(s.includes('ExecStart="/tmp/private-node/bin/node"'));assert(s.includes('PATH=/tmp/private-node/bin:'));assert(s.includes('WECHAT_ACCOUNT=default'))})
test('protocol checker handles missing executable with a safe actionable error',async t=>{const home=await fixture(t);const {checkCodex}=await import('../../src/setup/setup-core.mjs');await assert.rejects(checkCodex({binary:join(home,'no-codex'),cwd:home}),/CODEX_START_FAILED/)})
test('maintenance cancellation terminates only the operation-owned process group',async()=>{const {maintenanceRun}=await import('../../src/setup/maintenance-run.mjs');const c=new AbortController();const task=maintenanceRun(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal,timeout:10000});setTimeout(()=>c.abort(),50);await assert.rejects(task,/SETUP_CANCELLED/)})
test('both user guides are reachable without Codex',async t=>{const home=await fixture(t),out=[],controller=await new SetupController({stateDir:home}).init();assert.equal(setupCommand('使用说明'),'manual');assert.equal(setupCommand('guide'),'manualEn');await controller.handle('manual',text=>out.push(text));await controller.handle('manualEn',text=>out.push(text));assert(out[0].includes('永久删除'));assert(out[0].includes('五、图片和文件'));assert(!out[0].includes('（archive2）'));assert(out[1].includes('Permanently delete'));assert(out[1].includes('5. Images and files'));assert(!out[1].includes('五、图片和文件'))})
