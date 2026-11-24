import assert from 'node:assert/strict'
import test from 'node:test'
import {migrateNativeBindings} from '../../src/application/conversations/native-projects.mjs'

function fixture(saved,projects=[],thread=null){
 const entry={key:'owner-key',id:'1',name:'资料',titleSource:'local'}
 const root={entries:[entry],active:'1'},calls=[]
 const manager={state:{users:{[entry.key]:saved}},save:async()=>{},log:event=>calls.push(event)}
 const backendPort={
  readConversation:async()=>thread,
  listProjects:async()=>projects,
  nativeProjects:{
   create:async(_,name,path,key)=>{calls.push(['create',key]);return {id:'native',name,roots:[path]}},
   assignThread:async(_,id,project)=>calls.push(['assign',id,project]),
  },
 }
 const context={manager,backendPort,ensure:()=>root,withBackend:async(_,work)=>work({})}
 return {run:()=>migrateNativeBindings(context,'owner'),entry,calls}
}

test('standalone thread keeps its identity and gets no synthetic project',async()=>{
 const saved={threadId:'thread'},f=fixture(saved,[],{id:'thread',projectId:null})
 await f.run();await f.run()
 assert.deepEqual(saved,{threadId:'thread',nativeProjectId:null})
 assert.deepEqual(f.calls,[])
})
test('legacy project reuses a unique name and root, and attaches the original thread once',async()=>{
 const saved={threadId:'thread',workspace:'/work'},f=fixture(saved,[{id:'native',name:'资料',roots:['/work']}],{id:'thread',cwd:'/work'})
 await f.run();await f.run()
 assert.deepEqual(f.calls,[['assign','thread','native']])
 assert.equal(saved.threadId,'thread');assert.equal(saved.nativeProjectId,'native')
})
test('same-name projects with different roots are kept separate; ambiguous matches are preserved for review',async()=>{
 const saved={workspace:'/work'},p={id:'a',name:'资料',roots:['/elsewhere']}
 const f=fixture(saved,[p]);await f.run();await f.run()
 assert.deepEqual(f.calls,[['create','owner-key']])
 const other={workspace:'/elsewhere'},g=fixture(other,[p,{...p,id:'b'}]);await g.run()
 assert.deepEqual(g.calls,['migration.project_ambiguous']);assert.equal(other.nativeProjectId,undefined)
})
