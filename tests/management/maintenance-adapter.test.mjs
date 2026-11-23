import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ChatUpgrader,readChatUpgrade} from '../../src/setup/chat-upgrade.mjs'
import {AgentSwitcher} from '../../src/setup/agent-switch.mjs'
import {SetupController} from '../../src/setup/setup-controller.mjs'
import {createManagementMaintenanceController} from '../../src/interfaces/controllers/management-maintenance-controller.mjs'

test('maintenance adapter pins the checked release and exposes only sanitized account status',async t=>{
 const home=await mkdtemp(join(tmpdir(),'maintenance-adapter-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const stateDir=join(home,'state'),target=join(home,'source');await mkdir(join(stateDir,'logs'),{recursive:true});await mkdir(target)
 await writeFile(join(target,'.weixin-link-release.json'),JSON.stringify({version:1,repository:'zhangjingwei/weixin-link',ref:'v1.0.0',commit:'a'.repeat(40)}))
 await writeFile(join(stateDir,'logs/events.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),event:'rpc.failed',level:'error',code:'ETIMEDOUT',message:'secret test body',apiKey:'private-key',path:'/private/user-document'})+'\n')
 const account={id:'test',stateDir},scheduled=[]
 let latest={tag:'v1.2.0',commit:'c'.repeat(40)}
 const upgrader=new ChatUpgrader({home,target,latest:async()=>latest,deployment:async()=>({services:[{active:true,stateDir}]}),schedule:async value=>scheduled.push(value)})
 const agentSwitcher=new AgentSwitcher({home,account,targetRoot:target,deployment:async()=>({services:[{id:'test',active:true}]}),schedule:async(_account,value)=>scheduled.push(value)})
 const setupController=new SetupController({home,stateDir,accountId:'test',runDoctor:async()=>({ready:false,checks:[{name:'codexLoggedIn',ok:false,action:'private internal instruction'}]})})
 const port=createManagementMaintenanceController({account,home,setupController,agentSwitcher,upgrader,runtime:{status:()=>({ready:true,idle:false,counts:{sessions:1},token:'private-token'})}})
 const drift=await port.upgrade({tag:'v1.1.0',commit:'b'.repeat(40)})
 assert.equal(drift.status,'not_executed');assert.equal(drift.reason,'RELEASE_CHANGED');assert.equal(scheduled.length,0);assert.equal(await readChatUpgrade(home),null)
 latest={tag:'v1.1.0',commit:'b'.repeat(40)}
 const upgrade=await port.upgrade(latest);assert.equal(upgrade.status,'scheduled');assert.equal(scheduled[0].commit,latest.commit)
 assert.equal((await port.upgrade(latest)).status,'already_scheduled');assert.equal(scheduled.length,1)
 assert.equal((await port.restart()).status,'blocked');assert.equal(scheduled.length,1)
 const status=await port.status();assert.equal(status.upgrade.status,'waiting_idle');assert.equal(status.upgrade.version,'v1.1.0')
 const diagnostics=await port.diagnostics();assert.equal(diagnostics.recent_failures[0].code,'ETIMEDOUT')
 const installation=await port.installationStatus();assert.equal(installation.inferenceVerified,false);assert.equal(installation.checks[0].ok,false)
 const visible=JSON.stringify({status,diagnostics,installation,service:port.serviceStatus()})
 for(const secret of ['private-key','secret test body','/private/user-document','private-token','private internal instruction'])assert(!visible.includes(secret))
 assert((await port.guide('en')).text.includes('install-help'))
})

test('structured restart receipt is tied to the current account and deduplicates the worker',async t=>{
 const home=await mkdtemp(join(tmpdir(),'maintenance-restart-'));t.after(()=>rm(home,{recursive:true,force:true}))
 const account={id:'named',stateDir:home},scheduled=[]
 const switcher=new AgentSwitcher({home,account,targetRoot:home,deployment:async()=>({services:[{id:'named',active:true},{id:'another',active:true}]}),schedule:async(bound,request)=>scheduled.push({account:bound.id,id:request.id})})
 const result=await switcher.handle({action:'restart'},async()=>{})
 assert.equal(result.status,'scheduled');assert.equal(result.maintenanceId,scheduled[0].id);assert.equal(scheduled[0].account,'named')
 assert.equal((await switcher.handle({action:'restart'},async()=>{})).status,'already_scheduled');assert.equal(scheduled.length,1)
})
