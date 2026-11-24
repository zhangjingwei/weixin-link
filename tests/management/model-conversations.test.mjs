import {codexInput} from '../../src/base/codex/codex-input.mjs'
import {handoffReply} from '../../src/application/conversations/handoff-reply.mjs'
import {createHash} from 'node:crypto'
import {attachmentHandoffs} from '../../src/infrastructure/media/attachment-handoff.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ManagementService} from '../../src/application/management/management-service.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
import {DurableJobs} from '../../src/infrastructure/storage/durable-jobs.mjs'
import {EntryRouting} from '../../src/application/intake/entry-routing.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'model-conversations-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'state'));await mkdir(join(dir,'repo'));await mkdir(join(dir,'tree'))
 const manager=new SessionManager({stateDir:join(dir,'state'),cwd:dir,owners:['alice'],providerEnv:{},rpcFactory:()=>{throw Error('unexpected live connection')}})
 manager.state.users={alice:{threadId:'source'}};manager.save=async()=>{}
 const threads=new Map(),projects=new Map(),writes=[]
 const add=(id,cwd=join(dir,'repo'),projectId=null)=>{threads.set(id,{id,cwd,name:id,projectId,status:{type:'idle'}});return threads.get(id)}
 add('source',dir);add('old');add('worktree',join(dir,'tree'));add('other',dir)
 const api={read:async(_,id)=>{assert(projects.has(id));return projects.get(id)},createGroup:async(_,name,roots,key)=>{writes.push(['create',key]);const p={id:'native-project',name,roots};projects.set(p.id,p);return p},includeRoots:async(_,id,roots)=>{writes.push(['roots',id]);const p={...projects.get(id),roots};projects.set(id,p);return p},assignThread:async(_,id,projectId)=>{writes.push(['assign',id]);threads.get(id).projectId=projectId}}
 const backend={capabilities:{catalog:false,history:false},nativeProjects:api,readConversation:async(_,id)=>structuredClone(threads.get(id)),confirmSession:async s=>threads.get(s.threadId),withConnection:async(_,recipient,work)=>work({})}
 const conversations=new TextConversations(manager,['alice'],()=>({}),backend)
 const jobs=new DurableJobs(join(dir,'jobs.db'));t.after(()=>jobs.close());manager.submissions=jobs
 let count=0
 manager.connect=async key=>{const saved=manager.state.users[key];if(saved.threadId)return {threadId:saved.threadId};saved.threadId='created-'+(++count);add(saved.threadId,saved.workspace,saved.nativeProjectId);return {threadId:saved.threadId}}
 const service=new ManagementService({manager,conversations,enqueueTask:(...args)=>jobs.add(...args),inspectRepository:async cwd=>cwd===dir?{root:dir,commonDir:join(dir,'different.git')}:{root:cwd,commonDir:join(dir,'repo/.git')}});t.after(()=>service.close())
 return {dir,manager,conversations,jobs,service,threads,projects,writes,add,backend}
}

test('MCP opens standalone new and existing conversations without changing navigation; repeat receipt does not create another',async t=>{
 const f=await fixture(t),choices=await f.service.call('alice','list_workspace_choices',{projectId:'1'})
 const args={workspaceToken:choices.items[0].workspaceToken,requestId:'new-one'}
 const created=await f.service.call('alice','open_conversation',args)
 assert.equal(created.status,'confirmed');assert.equal(created.data.nativeProjectId,null);assert.equal(created.data.threadId,'created-1')
 assert.deepEqual(await f.service.call('alice','open_conversation',args),created)
 const second=await f.service.call('alice','open_conversation',{...args,requestId:'new-two'})
 assert.notEqual(second.data.threadId,created.data.threadId)
 const resumed=await f.service.call('alice','open_conversation',{threadId:'old',requestId:'resume'})
 assert.equal(resumed.data.threadId,'old');assert.equal(resumed.data.nativeProjectId,null)
 assert.equal(f.conversations.root.alice.active,'1')
 const mismatch=await f.service.call('alice','open_conversation',{threadId:'old',workspaceToken:args.workspaceToken,requestId:'relocate'})
 assert.equal(mismatch.status,'rejected')
})

test('project conversation rejects a thread still running in the shared assistant workspace',async t=>{
 const f=await fixture(t),root=join(f.dir,'repo')
 f.projects.set('textbook',{id:'textbook',name:'教材',roots:[root]})
 f.threads.get('source').projectId='textbook'
 const context=await f.service.call('alice','get_conversation_context',{})
 assert.equal(context.workspace,f.dir)
 assert.equal(context.projectWorkspace,'unverified')
 f.manager.state.users.alice.nativeProjectId='textbook'
 const mismatch=await f.service.call('alice','get_conversation_context',{})
 assert.equal(mismatch.projectWorkspace,'mismatch')
 const rejected=await f.service.call('alice','open_conversation',{nativeProjectId:'textbook',threadId:'source',requestId:'wrong-dir'})
 assert.equal(rejected.detail,'MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
 const created=await f.service.call('alice','open_conversation',{nativeProjectId:'textbook',requestId:'correct-dir'})
 assert.equal(created.status,'confirmed')
 assert.equal(f.manager.workspaceFor(f.conversations.find('alice',created.data.projectId).key),root)
 const valid=await f.service.call('alice','get_conversation_context',{})
 assert.equal(valid.projectWorkspace,'mismatch')
 assert.equal(f.manager.state.users.alice.threadId,'source')
})

test('project import refuses to attach a shared-workspace thread to a different project root',async t=>{
 const f=await fixture(t),choices=await f.service.call('alice','list_workspace_choices',{projectId:'1'})
 const selected=choices.items.find(item=>item.name==='repo')
 const rejected=await f.service.call('alice','request_project_import',{name:'教材',workspaceToken:selected.workspaceToken,threads:['source'],requestId:'import-wrong-dir'})
 assert.equal(rejected.detail,'MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
 assert.equal(f.threads.get('source').projectId,null)
})

test('original request, references and only current materials are handed off once with durable receipt',async t=>{
 const f=await fixture(t),opened=await f.service.call('alice','open_conversation',{threadId:'old',requestId:'open'})
 const original={text:'接着修复搜索，不改变筛选条件。',references:[{text:'引用材料'}],attachments:[{path:'/private/current.pdf',name:'资料.pdf',kind:'files'}]}
 const id=f.jobs.add('alice',original,'source-request');f.manager.sessions.set('alice',{busy:true,taskId:id})
 const info=await f.service.call('alice','get_conversation_context',{});assert.equal(info.sourceTaskId,id);assert.equal(info.alreadyRouted,false)
 let copied=0
 f.service.prepareHandoff=async({sourceKey,targetKey,ingressId,input})=>{copied++;assert.equal(sourceKey,'alice');assert.equal(ingressId,id);assert.notEqual(targetKey,'alice');return {...input,attachments:[{...input.attachments[0],path:'/private/target/current.pdf'}]}}
 const args={projectId:opened.data.projectId,threadId:'old',sourceTaskId:id,agreedPlan:'保留筛选条件，在搜索模块验证空结果。',requestId:'handoff'}
 const routed=await f.service.call('alice','route_conversation_request',args)
 assert.equal(routed.status,'queued')
 assert.match(handoffReply(f.manager.state,f.jobs,{userId:'alice',taskId:id}),/排队中；结果将在目标会话返回/)
 const target=f.jobs.get(routed.data.taskId)
 assert.equal(target.input.text,original.text);assert.deepEqual(target.input.references,original.references);assert.equal(target.input.attachments[0].path,'/private/target/current.pdf')
 assert.equal(target.input.agreedPlan,args.agreedPlan)
 assert.ok(codexInput(target.input).some(item=>item.text?.includes(args.agreedPlan)))
 assert.deepEqual(f.jobs.get(id).input,original)
 f.manager.sessions.get('alice').busy=false
 assert.deepEqual(await f.service.call('alice','route_conversation_request',args),routed);assert.equal(copied,1)
 f.manager.sessions.get('alice').busy=true
 const duplicate=await f.service.call('alice','route_conversation_request',{...args,requestId:'another-route'})
 assert.equal(duplicate.detail,'MANAGEMENT_SOURCE_ALREADY_ROUTED')
 assert.equal(f.conversations.root.alice.active,'1')
})

test('routing refuses an old project binding whose thread still uses the shared workspace',async t=>{
 const f=await fixture(t),opened=await f.service.call('alice','open_conversation',{threadId:'other',requestId:'open-old'})
 f.projects.set('toolbox',{id:'toolbox',name:'工具箱',roots:[join(f.dir,'repo')]})
 const target=f.conversations.find('alice',opened.data.projectId)
 f.manager.state.users[target.key].nativeProjectId='toolbox'
 const id=f.jobs.add('alice',{text:'修复教材游戏'},'request')
 f.manager.sessions.set('alice',{busy:true,taskId:id})
 const result=await f.service.call('alice','route_conversation_request',{projectId:opened.data.projectId,threadId:'other',sourceTaskId:id,requestId:'wrong-target'})
 assert.equal(result.detail,'MANAGEMENT_PROJECT_WORKSPACE_MISMATCH')
 assert.equal(f.jobs.pending().length,1)
})

test('expired source, stale target, missing attachment copier and routed source never enqueue new work',async t=>{
 const f=await fixture(t),opened=await f.service.call('alice','open_conversation',{threadId:'old',requestId:'open'})
 const id=f.jobs.add('alice',{text:'修复',images:['/private/current.png']},'source');f.manager.sessions.set('alice',{busy:true,taskId:id})
 const args={projectId:opened.data.projectId,threadId:'old',sourceTaskId:id,requestId:'no-copier'}
 assert.equal((await f.service.call('alice','route_conversation_request',args)).detail,'MANAGEMENT_ATTACHMENT_HANDOFF_UNAVAILABLE')
 assert.equal((await f.service.call('alice','route_conversation_request',{...args,threadId:'changed',requestId:'stale'})).detail,'MANAGEMENT_STALE_TARGET')
 f.manager.sessions.get('alice').busy=false
 assert.equal((await f.service.call('alice','route_conversation_request',{...args,requestId:'expired'})).detail,'MANAGEMENT_SOURCE_TASK_CHANGED')
 assert.equal(f.jobs.pending().length,1)
 const forwarded=f.jobs.add('alice',{text:'已分流任务',projectDispatch:{entryOrigin:false}},'forwarded')
 f.manager.sessions.set('alice',{busy:true,taskId:forwarded})
 assert.equal((await f.service.call('alice','route_conversation_request',{...args,sourceTaskId:forwarded,requestId:'loop'})).detail,'MANAGEMENT_NESTED_DISPATCH_DENIED')
 assert.equal((await f.service.call('alice','open_conversation',{threadId:'old',requestId:'loop-open'})).detail,'MANAGEMENT_NESTED_DISPATCH_DENIED')
})

test('model can group verified repo worktrees without merging directories or history',async t=>{
 const f=await fixture(t),proof=await f.service.call('alice','get_conversation_repository',{threadId:'old'})
 const args={name:'代码仓库',workspaceToken:proof.workspaceToken,threadIds:['old','worktree'],requestId:'group'}
 const result=await f.service.call('alice','associate_repository_conversations',args)
 assert.equal(result.status,'confirmed');assert.equal(result.data.nativeProjectId,'native-project')
 assert.equal(f.threads.get('old').projectId,'native-project');assert.equal(f.threads.get('worktree').projectId,'native-project')
 assert.equal(f.threads.get('worktree').cwd,join(f.dir,'tree'))
 assert.deepEqual(f.projects.get('native-project').roots,[join(f.dir,'repo'),join(f.dir,'tree')])
 const count=f.writes.length;await f.service.call('alice','associate_repository_conversations',args);assert.equal(f.writes.length,count)
})

test('grouping checks all candidates before writing and refuses another repo or explicit project',async t=>{
 const f=await fixture(t),proof=await f.service.call('alice','get_conversation_repository',{threadId:'old'})
 const args={name:'仓库',workspaceToken:proof.workspaceToken,threadIds:['old','other'],requestId:'mixed'}
 assert.equal((await f.service.call('alice','associate_repository_conversations',args)).detail,'MANAGEMENT_REPOSITORY_MISMATCH')
 assert.equal(f.writes.length,0)
 f.threads.get('worktree').projectId='explicit'
 assert.equal((await f.service.call('alice','associate_repository_conversations',{...args,threadIds:['old','worktree'],requestId:'explicit'})).detail,'MANAGEMENT_EXISTING_PROJECT_MEMBERSHIP')
 assert.equal(f.writes.length,0)
})

test('existing repo project gains a verified worktree root instead of creating another project',async t=>{
 const f=await fixture(t);f.projects.set('existing',{id:'existing',name:'现有项目',roots:[join(f.dir,'repo')]})
 f.threads.get('old').projectId='existing'
 const proof=await f.service.call('alice','get_conversation_repository',{threadId:'old'})
 const result=await f.service.call('alice','associate_repository_conversations',{nativeProjectId:'existing',workspaceToken:proof.workspaceToken,threadIds:['old','worktree'],requestId:'reuse'})
 assert.equal(result.status,'confirmed');assert.equal(result.data.nativeProjectId,'existing');assert(!f.writes.some(([method])=>method==='create'))
 assert.deepEqual(f.projects.get('existing').roots,[join(f.dir,'repo'),join(f.dir,'tree')])
})

test('model managed mode sends ordinary requests to the execution model without heuristic classification',async()=>{
 const router=new EntryRouting({modelManagedConversations:true,classify:async()=>assert.fail('must not classify')})
 assert.equal(await router.process({text:'接着聊或者另开一条',_ingressId:'input'},{current:()=>true}),false)
 await router.close()
})

test('real private attachment copy keeps parser metadata and rewrites paths in the forwarded input',async t=>{
 const f=await fixture(t),opened=await f.service.call('alice','open_conversation',{threadId:'old',requestId:'open'})
 const inbox=join(f.dir,'state/attachments',createHash('sha256').update('alice').digest('hex').slice(0,24),'incoming')
 await mkdir(inbox,{recursive:true});const path=join(inbox,'notes.txt');await writeFile(path,'test material')
 const original={text:'读取本轮附件：'+path,attachments:[{path,name:'notes.txt',kind:'files',processing:{status:'text_ready'}}]}
 const id=f.jobs.add('alice',original,'material-source');f.manager.sessions.set('alice',{busy:true,taskId:id})
 const handoffs=attachmentHandoffs(join(f.dir,'state'),f.jobs);f.service.prepareHandoff=args=>handoffs.prepare(args)
 const result=await f.service.call('alice','route_conversation_request',{projectId:opened.data.projectId,threadId:'old',sourceTaskId:id,requestId:'copy'})
 assert.equal(result.status,'queued')
 const input=f.jobs.get(result.data.taskId).input
 assert(input.attachmentHandoff.id);assert.notEqual(input.attachments[0].path,path)
 assert.equal(await readFile(input.attachments[0].path,'utf8'),'test material')
 assert.equal(input.text,'读取本轮附件：'+input.attachments[0].path)
 assert.equal(input.attachments[0].processing.status,'text_ready')
 assert.equal(f.jobs.get(id).input.text,original.text)
})

test('repository changes reject before writes and membership races after creation remain explicitly unknown',async t=>{
 const f=await fixture(t),proof=await f.service.call('alice','get_conversation_repository',{threadId:'old'})
 const args={name:'仓库',workspaceToken:proof.workspaceToken,threadIds:['old','worktree'],requestId:'changed'}
 f.threads.get('old').cwd=f.dir
 assert.equal((await f.service.call('alice','associate_repository_conversations',args)).detail,'MANAGEMENT_REPOSITORY_CHANGED')
 assert.equal(f.writes.length,0);f.threads.get('old').cwd=join(f.dir,'repo')
 const create=f.backend.nativeProjects.createGroup
 f.backend.nativeProjects.createGroup=async(...args)=>{const p=await create(...args);f.threads.get('worktree').projectId='new-explicit-project';return p}
 const result=await f.service.call('alice','associate_repository_conversations',{...args,requestId:'race'})
 assert.equal(result.status,'unknown');assert.equal(result.data.nativeProjectId,'native-project')
 assert.equal(f.threads.get('worktree').projectId,'new-explicit-project')
 assert(!f.writes.some(([method])=>method==='assign'))
})
