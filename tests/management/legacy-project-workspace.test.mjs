import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {repairLegacyProjectWorkspace} from '../../src/application/conversations/native-projects.mjs'

async function fixture(t){
 const base=await mkdtemp(join(tmpdir(),'legacy-project-workspace-'))
 t.after(()=>rm(base,{recursive:true,force:true}))
 let old=join(base,'assistant'),target=join(base,'toolbox')
 await Promise.all([mkdir(old),mkdir(target)]);old=await realpath(old);target=await realpath(target)
 const saved={threadId:'old-thread',workspace:old,nativeProjectId:'toolbox',hasMessages:true}
 let forks=0,assignments=0,saves=0,queued=[]
 const source={id:'old-thread',cwd:old,projectId:'toolbox',status:{type:'idle'}}
 const context={manager:{state:{users:{key:saved}},save:async()=>{saves++}},backendPort:{nativeProjects:{read:async()=>({id:'toolbox',roots:[target]}),assignThread:async()=>{assignments++}},readConversation:async()=>({id:'fork-thread',cwd:target,projectId:'toolbox'})}}
 const rpc={request:async(method,params)=>{
  if(method==='thread/queue/list')return {data:queued}
  if(method==='thread/fork'){forks++;assert.equal(params.cwd,target);assert.equal(params.deferGoalContinuation,true);return {thread:{id:'fork-thread',cwd:target,projectId:'toolbox'}}}
  assert.fail(method)
 }}
 return {old,target,saved,source,context,rpc,setQueued:value=>queued=value,counts:()=>({forks,assignments,saves})}
}

test('legacy project conversation forks its history into the sole project root and keeps the source thread',async t=>{
 const f=await fixture(t)
 assert.equal(await repairLegacyProjectWorkspace(f.context,'key',f.rpc,f.source),true)
 assert.equal(f.saved.threadId,'fork-thread')
 assert.equal(f.saved.workspace,f.target)
 assert.deepEqual(f.saved.previous,['old-thread'])
 assert.equal(f.saved.workspaceMigratedFrom,'old-thread')
 assert.equal(f.saved.hasMessages,true)
 assert.deepEqual(f.counts(),{forks:1,assignments:0,saves:1})
 assert.equal(await repairLegacyProjectWorkspace(f.context,'key',f.rpc,{id:'fork-thread',cwd:f.target,status:{type:'idle'}}),false)
 assert.equal(f.counts().forks,1)
})

test('legacy project conversation does not move an active or queued thread',async t=>{
 const f=await fixture(t)
 await assert.rejects(repairLegacyProjectWorkspace(f.context,'key',f.rpc,{...f.source,status:{type:'active'}}),/MANAGEMENT_TARGET_UNAVAILABLE/)
 f.setQueued([{id:'queued'}])
 await assert.rejects(repairLegacyProjectWorkspace(f.context,'key',f.rpc,f.source),/MANAGEMENT_TARGET_UNAVAILABLE/)
 assert.equal(f.saved.threadId,'old-thread')
 assert.equal(f.counts().forks,0)
})

test('legacy project conversation keeps its binding if the fork cannot be verified',async t=>{
 const f=await fixture(t)
 f.context.backendPort.readConversation=async()=>({id:'fork-thread',cwd:f.old,projectId:'toolbox'})
 await assert.rejects(repairLegacyProjectWorkspace(f.context,'key',f.rpc,f.source),/CODEX_WORKSPACE_FORK_UNCONFIRMED/)
 assert.equal(f.saved.threadId,'old-thread')
 assert.equal(f.saved.workspace,f.old)
})
