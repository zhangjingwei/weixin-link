import test from 'node:test'
import assert from 'node:assert/strict'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'

function fixture(t){
 const entries=[{id:'1',key:'alice',owner:'alice',name:'Entry'},{id:'2',key:'project',owner:'alice',name:'Project'}]
 const manager={state:{users:{alice:{threadId:'a'},project:{threadId:'p'}}},sessions:new Map([['alice',{busy:true,model:'old'}]]),questions:new Map(),save:async()=>{},protocol:{supportsModels:true,providerOptions:()=>({provider:null}),listModels:async()=>({models:[{model:'allowed'}]})}}
 const conversations={root:{alice:{entries,active:'1'}},realOwners:new Set(['alice']),entry:key=>entries.find(e=>e.key===key),withBackend:async(_,fn)=>fn({})}
 const service=new ManagementService({manager,conversations});t.after(()=>service.close());return {manager,service,conversations}
}
test('selection is project scoped, durable, idempotent and does not interrupt the caller',async t=>{
 const {manager,service}=fixture(t),args={projectId:'2',model:'allowed',requestId:'one'}
 let persisted;manager.save=async()=>{persisted=structuredClone(manager.state)}
 const result=await service.call('alice','request_model_switch',args)
 assert.equal(result.status,'configured');assert.equal(result.data.effective,'next_turn')
 assert.equal(persisted.users.project.modelOverride,'allowed');assert.equal(manager.state.users.alice.modelOverride,undefined)
 assert.equal(manager.sessions.get('alice').model,'old');assert.equal(manager.sessions.get('alice').busy,true)
 assert.equal((await service.call('alice','request_model_switch',args)).operationId,result.operationId)
 await assert.rejects(service.call('alice','request_model_switch',{...args,model:'other'}),/REQUEST_CONFLICT/)
 assert.equal((await service.call('alice','get_project_status',{projectId:'2'})).configuredModel,'allowed')
})
test('unavailable models, foreign projects, fixed providers and archived targets do not change preferences',async t=>{
 const {manager,service,conversations}=fixture(t)
 for(const [projectId,model] of [['foreign','allowed'],['2','invalid']]){
  const r=await service.call('alice','request_model_switch',{projectId,model,requestId:projectId+model});assert.equal(r.status,'rejected')
 }
 manager.protocol.providerOptions=()=>({provider:'external'})
 assert.equal((await service.call('alice','request_model_switch',{projectId:'2',model:'allowed',requestId:'fixed'})).status,'rejected')
 manager.protocol.providerOptions=()=>({provider:null});conversations.root.alice.entries[1].archived=true
 assert.equal((await service.call('alice','request_model_switch',{projectId:'2',model:'allowed',requestId:'archive'})).status,'rejected')
 assert.equal(manager.state.users.project.modelOverride,undefined)
})
test('a failed preference save restores memory and stays uncertain without automatic replay',async t=>{
 const {manager,service}=fixture(t);let saves=0
 manager.save=async()=>{if(++saves===2)throw Error('storage failed')}
 const args={projectId:'2',model:'allowed',requestId:'failure'},r=await service.call('alice','request_model_switch',args)
 assert.equal(r.status,'unknown');assert.equal(manager.state.users.project.modelOverride,undefined)
 await service.call('alice','request_model_switch',args);assert.equal(saves,3)
})
test('saved model selection is applied on reconnect and subsequent turn requests',async()=>{
 const protocol=createSessionProtocol(),calls=[],rpc={request:async(method,args)=>{calls.push({method,args});return {thread:{id:'thread'},model:args.model,sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}}}
 await protocol.open(rpc,{saved:{threadId:'thread',modelOverride:'allowed'},cwd:'/tmp',instructions:'',provider:{provider:null,thread:{}}})
 assert.equal(calls.find(c=>c.method==='thread/resume').args.model,'allowed')
 await protocol.startTurn(rpc,{threadId:'thread',input:[],model:'allowed'})
 assert.equal(calls.find(c=>c.method==='turn/start').args.collaborationMode.settings.model,'allowed')
})

test('the existing session manager uses a saved choice for normal turns after reconnect',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs')
 const dir=await mkdtemp(join(tmpdir(),'model-switch-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const turns=[],manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['alice'],providerEnv:{},rpcFactory:()=>({closed:false,close(){this.closed=true},write(){},async request(method,args){
  if(method==='turn/start'){turns.push(args);return {turn:{id:'turn'}}}
  if(method.startsWith('thread/'))return {thread:{id:'thread'},model:args.model??'original',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
  return {}
 }})}).init();t.after(()=>manager.close())
 manager.state.users.alice={modelOverride:'allowed'};await manager.save()
 const contexts=[];manager.submissions={context:(id,value)=>contexts.push({id,...value}),bind(){},submitted(){}}
 const session=await manager.connect('alice',async()=>{});session.model='old-connected-model';await manager.send(session,{text:'ordinary task',deliveryId:'task-1'})
 assert.equal(turns[0].collaborationMode.settings.model,'allowed')
 assert.equal(contexts[0].executionModel,'allowed')
})
