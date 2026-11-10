import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync,spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {validateConfig,configSchema} from '../../src/setup/config-schema.mjs'
import {configure,restoreConfiguration,configStatus,configPath,guardRemoteConfiguration} from '../../src/setup/config-manager.mjs'
import {atomicConfigWrite,digest} from '../../src/setup/config-files.mjs'
import {updateWorkspaceGuidance} from '../../src/setup/workspace-guidance.mjs'
const repo=fileURLToPath(new URL('../../',import.meta.url)),verify=async()=>{}
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'zerolink-config-'));t.after(()=>rm(home,{recursive:true,force:true}));return {home,workspace:join(home,'workspace'),env:{},verify}}
const ha=token=>({version:1,baseUrl:'http://homeassistant.local:8123',token})
test('published samples are accepted by the actual schemas, and legacy configuration normalizes to v1',async()=>{
 for(const kind of ['ha','backup'])assert.equal(validateConfig(kind,JSON.parse(await readFile(join(repo,'config-templates/'+kind+'.example.json'),'utf8'))).version,1)
 assert.equal(validateConfig('ha',{baseUrl:'http://localhost',token:'fixture'}).version,1)
 assert.equal(validateConfig('remote-hosts',{}).version,1);assert.equal(configSchema('ha').additionalProperties,false)
 for(const value of [{...ha('x'),version:2},{...ha('x'),arbitrary:'ignored'},{...ha('x'),token:'x\ny'},{...ha('x'),baseUrl:'http://user:password@host'}])assert.throws(()=>validateConfig('ha',value),/CONFIG_/)
 assert.throws(()=>validateConfig('backup',{host:'-oProxyCommand=bad',remoteDirectory:'/tmp'}),/CONFIG_/)
 assert.throws(()=>validateConfig('backup',{host:'backup',remoteDirectory:'/srv/../etc'}),/CONFIG_/)
 assert.throws(()=>validateConfig('remote-hosts',{server:{platform:'win32',binary:'C:\\codex.exe',root:'C:\\work',transport:'daemon-proxy'}}),/CONFIG_INVALID_TRANSPORT/)
})
test('successful updates verify first, keep a private previous version and restore without replaying writes',async t=>{
 const options=await fixture(t),path=configPath('ha',options);let probes=0;options.verify=async()=>{probes++}
 await configure('ha',ha('fixture-one'),options);await configure('ha',ha('fixture-two'),options)
 assert.equal(JSON.parse(await readFile(path+'.previous','utf8')).token,'fixture-one');assert.equal(probes,2)
 if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o600)
 await writeFile(path,'{broken direct edit')
 const result=await restoreConfiguration('ha',options);assert.equal(result.verified,true);assert.equal(JSON.parse(await readFile(path,'utf8')).token,'fixture-one')
})
test('schema or connection failure never replaces working configuration and never echoes credentials',async t=>{
 const options=await fixture(t),path=configPath('ha',options);await configure('ha',ha('working-fixture'),options);const old=await readFile(path,'utf8')
 await assert.rejects(configure('ha',{...ha('new-fixture'),version:99},options),/CONFIG_UNSUPPORTED_VERSION/)
 await assert.rejects(configure('ha',ha('new-fixture'),{...options,verify:async()=>{throw Error('verification failed')}}))
 assert.equal(await readFile(path,'utf8'),old)
 const secret='not-a-real-private-fixture',r=spawnSync(process.execPath,[join(repo,'src/setup/setup.mjs'),'config-check','ha'],{input:JSON.stringify({...ha(secret),baseUrl:'invalid-url'}),encoding:'utf8',env:{...process.env,HOME:options.home}})
 assert.equal(r.status,1);assert.ok(!r.stderr.includes(secret));assert.equal(JSON.parse(r.stderr).field,'baseUrl')
})
test('concurrent direct edits and an existing write lock are refused without overwriting them',async t=>{
 const options=await fixture(t),path=configPath('ha',options);await configure('ha',ha('first'),options)
 await assert.rejects(configure('ha',ha('second'),{...options,verify:async()=>writeFile(path,JSON.stringify(ha('concurrent')))}),/CONFIG_CHANGED_DURING_CHECK/)
 assert.equal(JSON.parse(await readFile(path,'utf8')).token,'concurrent')
 await mkdir(path+'.write-lock');await assert.rejects(atomicConfigWrite(path,'{}'),/CONFIG_BUSY/);await rm(path+'.write-lock',{recursive:true})
})
test('optional invalid config status is isolated and redacted',async t=>{
 const options=await fixture(t),path=configPath('ha',options);await mkdir(join(options.home,'.config/wechat-assistant'),{recursive:true});await writeFile(path,'{"token":"private-fixture","baseUrl":false}')
 const status=await configStatus(options);assert.equal(status.ha.valid,false);assert.equal(status.backup.configured,false);assert.ok(!JSON.stringify(status).includes('private-fixture'))
})
test('installation config cannot silently migrate an existing workspace',async t=>{
 const options=await fixture(t);await mkdir(options.workspace);await configure('installation',{workspace:options.workspace},options)
 await assert.rejects(configure('installation',{workspace:join(options.home,'different')},options),/CONFIG_WORKSPACE_MIGRATION_REQUIRED/)
})
test('remote configuration seals only idle runtimes and reports unconfirmed resume after a committed write',async t=>{
 const calls=[];const control=async(endpoint,method,path)=>{calls.push(path);if(path==='/drain')return {idle:false};return {}}
 await assert.rejects(guardRemoteConfiguration({endpoints:['test'],control}),/CONFIG_RUNTIME_BUSY/);assert.deepEqual(calls,['/drain','/resume'])
 const options=await fixture(t);await mkdir(options.workspace)
 const result=await configure('remote-hosts',{hosts:{}},{...options,guard:async()=>async()=>({resumed:false})})
 assert.equal(result.written,true);assert.equal(result.runtimeResumed,false);assert.equal(result.warning,'CONFIG_RUNTIME_RESUME_UNCONFIRMED')
})
test('config-set saves offline remote hosts without trying to connect',async t=>{
 const options=await fixture(t);await mkdir(options.workspace)
 const host={platform:'posix',binary:'/opt/codex',root:'/projects',transport:'daemon-proxy'}
 const input={hosts:{offlineA:host,offlineB:{...host,root:'/workspace'}}}
 const env={...process.env,HOME:options.home,WECHAT_REMOTE_WORKSPACE:options.workspace};delete env.WECHAT_REMOTE_HOSTS
 const command=spawnSync(process.execPath,[join(repo,'src/setup/setup.mjs'),'config-set','remote-hosts'],{input:JSON.stringify(input),encoding:'utf8',env,timeout:3000})
 assert.equal(command.status,0,command.stderr)
 const result=JSON.parse(command.stdout);assert.equal(result.written,true);assert.equal(result.verified,false)
 assert.deepEqual(JSON.parse(await readFile(join(options.workspace,'remote-hosts.json'),'utf8')).hosts,input.hosts)
})
test('managed workspace guidance preserves user content and is idempotent',async t=>{
 const options=await fixture(t);await mkdir(options.workspace);const path=join(options.workspace,'AGENTS.md'),original='# User rules\nKeep this exact text.\n';await writeFile(path,original)
 const args={workspace:options.workspace,root:repo,codexBinary:process.execPath};await updateWorkspaceGuidance(args);const first=await readFile(path,'utf8');assert.ok(first.startsWith(original));assert.ok(first.includes('config-set'));assert.ok(first.includes('原生记忆'))
 await updateWorkspaceGuidance(args);assert.equal(await readFile(path,'utf8'),first)
 await writeFile(path,'user text\n<!-- zerolink:managed:start -->broken');await assert.rejects(updateWorkspaceGuidance(args),/AGENTS_MANAGED_SECTION_INVALID/)
 assert.equal(await readFile(path,'utf8'),'user text\n<!-- zerolink:managed:start -->broken')
})
test('existing symlink configuration is not followed',{skip:process.platform==='win32'},async t=>{
 const options=await fixture(t),path=configPath('ha',options),other=join(options.home,'other');await mkdir(join(options.home,'.config/wechat-assistant'),{recursive:true});await writeFile(other,'keep');await symlink(other,path)
 await assert.rejects(configure('ha',ha('fixture'),options),/CONFIG_UNSAFE_FILE/);assert.equal(await readFile(other,'utf8'),'keep')
})
test('bad optional remote configuration does not prevent an ordinary local turn',async t=>{
 const options=await fixture(t);await mkdir(options.workspace);await writeFile(join(options.workspace,'remote-hosts.json'),'{broken')
 const script=`import {SessionManager} from ${JSON.stringify(new URL('../../src/wechat/session-manager.mjs',import.meta.url).href)};let starts=0;const m=await new SessionManager({stateDir:process.env.HOME+'/state',cwd:process.env.WECHAT_REMOTE_WORKSPACE,owners:['u'],rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method){if(method==='turn/start'){starts++;return {turn:{id:'turn'}}}return method.startsWith('thread/')?{thread:{id:'thread'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}:{}}})}).init();const s=await m.connect('u',async()=>{});await m.send(s,'ordinary local request');m.close();console.log(JSON.stringify({starts}));`
 const result=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,HOME:options.home,WECHAT_REMOTE_WORKSPACE:options.workspace}});assert.equal(JSON.parse(result).starts,1)
})
test('schema command is machine-readable and rejects inherited object property names',()=>{
 for(const kind of ['constructor','toString'])assert.throws(()=>validateConfig(kind,{}),/CONFIG_UNKNOWN_KIND/)
 const text=execFileSync(process.execPath,[join(repo,'src/setup/setup.mjs'),'config-schema','ha'],{encoding:'utf8'});const schema=JSON.parse(text);assert.equal(schema.properties.version.const,1);assert.ok(schema.required.includes('token'))
})
test('invalid installation binary cannot replace the active installation file',async t=>{
 const options=await fixture(t);await mkdir(options.workspace);await configure('installation',{workspace:options.workspace},options);const path=configPath('installation',options),old=await readFile(path,'utf8')
 await assert.rejects(configure('installation',{workspace:options.workspace,codexBinary:process.execPath},{...options,verify:undefined}),/CONFIG_CONNECTION_CHECK_FAILED/)
 assert.equal(await readFile(path,'utf8'),old)
})
test('versioned remote configuration reloads, while existing transports keep their original destination',async t=>{
 const options=await fixture(t);await mkdir(options.workspace);const path=join(options.workspace,'remote-hosts.json')
 const script=`import {writeFileSync} from 'node:fs';const path=process.env.WECHAT_REMOTE_HOSTS;const host={platform:'posix',binary:'/opt/codex',root:'/old',transport:'daemon-proxy'};writeFileSync(path,JSON.stringify({version:1,hosts:{server:host}}));const {configuredHost,remoteConfigStatus}=await import(${JSON.stringify(new URL('../../src/infrastructure/remote/host-config.mjs',import.meta.url).href)});const {RemoteTransport}=await import(${JSON.stringify(new URL('../../src/infrastructure/remote/ssh-transport.mjs',import.meta.url).href)});const t=new RemoteTransport('server');writeFileSync(path,JSON.stringify({version:1,hosts:{server:{...host,root:'/new'}}}));const current=configuredHost('server').root;writeFileSync(path,'{invalid');console.log(JSON.stringify({original:t.config.root,current,invalid:!remoteConfigStatus().valid}));`
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,HOME:options.home,WECHAT_REMOTE_WORKSPACE:options.workspace,WECHAT_REMOTE_HOSTS:path}}));assert.deepEqual(result,{original:'/old',current:'/new',invalid:true})
})
test('remote configuration cannot remove or retarget an unreconciled task host',async t=>{
 const options=await fixture(t);await mkdir(options.workspace)
 const host={platform:'posix',binary:'/opt/codex',root:'/projects',transport:'daemon-proxy'},guard=async()=>async()=>({resumed:true})
 await configure('remote-hosts',{hosts:{server:host}},{...options,guard})
 await writeFile(join(options.workspace,'remote-sessions.json'),JSON.stringify({task:{kind:'official-remote-task',host:'server',cwd:'/projects/demo',thread_id:'owned-thread',turn_id:'owned-turn'}}))
 await assert.rejects(configure('remote-hosts',{hosts:{}},{...options,guard}),/CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION/)
 await assert.rejects(configure('remote-hosts',{hosts:{server:{...host,root:'/other'}}},{...options,guard}),/CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION/)
})
