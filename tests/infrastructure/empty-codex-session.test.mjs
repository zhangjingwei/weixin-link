import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {findCodex} from '../../src/infrastructure/config/install-config.mjs'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
test('real isolated Codex empty connections can idle-release and reopen across a manager restart without stale persisted IDs',async t=>{
 let binary;try{binary=findCodex();await access(binary)}catch(error){if(error.code==='ENOENT'||error.message==='CODEX_BUNDLED_PLATFORM_UNSUPPORTED')return t.skip('Codex CLI is unavailable');throw error}
 const home=await mkdtemp(join(tmpdir(),'empty-codex-')),options={stateDir:join(home,'state'),cwd:home,owners:['owner'],sessionProtocol:createSessionProtocol({codexHome:home,codexBinary:()=>binary,providerEnv:{}})}
 let manager
 t.after(async()=>{manager?.close();await manager?.saving;await delay(200);await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:50})})
 manager=await new SessionManager(options).init()
 const first=await manager.connect('owner',async()=>{});assert.equal(first.provisionalThread,true)
 assert.equal(manager.state.users.owner.threadId,undefined)
 first.lastUserInputAt=Date.now()-10*60*1000-1;manager.scheduleIdleRelease(first)
 for(let i=0;i<100&&manager.sessions.has('owner');i++)await delay(10)
 assert.equal(manager.sessions.has('owner'),false);await manager.releasing.get('owner')
 const second=await manager.connect('owner',async()=>{});assert.notEqual(second.threadId,first.threadId)
 await manager.save();assert.equal(JSON.parse(await readFile(join(options.stateDir,'assistant-sessions.json'),'utf8')).users.owner.threadId,undefined)
 manager.close();await manager.saving;await delay(100)
 manager=await new SessionManager(options).init();const third=await manager.connect('owner',async()=>{})
 assert.equal(third.provisionalThread,true);assert.equal(manager.state.users.owner.threadId,undefined)
 // No turn/start or model prompt is submitted in this test.
})
