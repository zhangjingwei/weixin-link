import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {OutputStore,OutputTransport} from '../../src/infrastructure/media/outbound-media.mjs'
import {completeArtifacts,pruneArtifacts} from '../../src/infrastructure/media/artifact-lifecycle.mjs'
import {SessionManager} from '../../src/wechat/session-manager.mjs'
const WEEK=7*24*60*60*1000
async function fixture(work){
 const dir=await mkdtemp(join(tmpdir(),'artifact-delivery-')),cwd=join(dir,'repo'),stateDir=join(dir,'.private-state')
 await mkdir(join(cwd,'outputs'),{recursive:true})
 const store=new OutputStore({stateDir,cwd})
 try{await work({dir,cwd,stateDir,store})}finally{await rm(dir,{recursive:true,force:true})}
}
test('relative explicit links produce real attachments; invalid and missing links stay partial',()=>fixture(async({cwd,store})=>{
 await writeFile(join(cwd,'outputs','report.md'),'complete report')
 const packet=await store.package('owner','[报告](outputs/report.md) [缺失](outputs/missing.md) [不支持](outputs/app.xyz) [越界](../outside.md)')
 assert.equal(packet.attachments.length,1)
 assert.deepEqual(packet.errors.map(e=>e.code),['FILE_NOT_FOUND','UNSUPPORTED_FILE','EXPORT_PATH_REFUSED'])
 const calls=[],transport=new OutputTransport({store,send:async(_user,value)=>calls.push(value)})
 assert.equal((await transport.deliver('owner',packet)).status,'partial')
 assert.equal(calls.find(v=>typeof v==='object').file.toString(),'complete report')
 assert.match(calls.at(-1),/附件未能确认送达/)
 await access(join(cwd,'outputs','report.md')) // project source is never deleted
}))
test('managed originals are removed only after acceptance; immutable private snapshots allow replay',()=>fixture(async({store,cwd})=>{
 const directory=await store.deliveryDirectory('owner'),source=join(directory,'report.md')
 assert.ok(!directory.startsWith(cwd+'/'))
 assert.equal((await stat(directory)).mode&0o777,0o700)
 await writeFile(source,'private report')
 const packet=await store.package('owner',`[报告](${source})`)
 await access(source)
 const transport=new OutputTransport({store,send:async(_user,value)=>{if(typeof value==='object')await access(source)}})
 assert.equal((await transport.deliver('owner',packet)).status,'accepted')
 await assert.rejects(access(source),{code:'ENOENT'})
 assert.equal((await store.bytes('owner',packet.attachments[0])).toString(),'private report')
 assert.equal((await new OutputTransport({store,send:async()=>{}}).deliver('owner',store.replay(packet))).status,'accepted')
 await assert.rejects(store.bytes('other',packet.attachments[0]))
}))
test('changed originals and ambiguous uploads are preserved',()=>fixture(async({store})=>{
 const root=await store.deliveryDirectory('owner'),source=join(root,'report.md')
 await writeFile(source,'original')
 const packet=await store.package('owner',`[报告](${source})`)
 await writeFile(source,'changed')
 await new OutputTransport({store,send:async()=>{}}).deliver('owner',packet)
 assert.equal(await readFile(source,'utf8'),'changed')
 const next=await store.package('owner',`[报告](${source})`)
 const transport=new OutputTransport({store,maxRetries:0,send:async(_user,value)=>{if(typeof value==='object')throw Error('timeout')}})
 assert.equal((await transport.deliver('owner',next)).status,'partial')
 assert.equal(next.attachments[0].status,'unknown')
 assert.equal(await readFile(source,'utf8'),'changed')
}))
test('expiry affects only completed bundles of the same owner and survives store recreation',()=>fixture(async({store,stateDir,cwd})=>{
 const source=join(cwd,'outputs','report.md');await writeFile(source,'report')
 const completed=await store.package('owner',`[报告](${source})`)
 const pending=await store.package('owner',`[报告](${source})`)
 const other=await store.package('other',`[报告](${source})`)
 completed.attachments[0].status='accepted'
 await completeArtifacts(store,'owner',completed,Date.now()-WEEK-1000)
 await assert.rejects(store.bytes('owner',completed.attachments[0]),/ARTIFACT_EXPIRED/)
 const restored=new OutputStore({stateDir,cwd})
 await pruneArtifacts(restored,'owner')
 await assert.rejects(access(completed.attachments[0].path),{code:'ENOENT'})
 await access(pending.attachments[0].path);await access(other.attachments[0].path);await access(source)
}))
test('private source directories cannot be exported by another conversation',()=>fixture(async({store})=>{
 const root=await store.deliveryDirectory('owner'),source=join(root,'report.md');await writeFile(source,'private')
 const packet=await store.package('other',`[报告](${source})`)
 assert.equal(packet.attachments.length,0);assert.equal(packet.errors[0].code,'EXPORT_PATH_REFUSED')
}))
test('relative links reach packaging through the session completion gate',()=>fixture(async({cwd,stateDir})=>{
 await writeFile(join(cwd,'outputs','report.md'),'report')
 const manager=await new SessionManager({stateDir,cwd,owners:['owner']}).init(),output=[]
 manager.state.users.owner={}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:['[报告](outputs/report.md)'],items:new Map(),queue:[],reply:async value=>output.push(value)}
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 assert.equal(output[0].attachments.length,1)
 const instructions=await manager.sessionInstructions('owner')
 assert.ok(instructions.includes(join(stateDir,'deliverables')))
}))
test('unexpected packaging failures remain failed artifact bundles rather than accepted text',()=>fixture(async({cwd,stateDir})=>{
 const manager=await new SessionManager({stateDir,cwd,owners:['owner']}).init(),output=[]
 manager.outputStore.package=async()=>{throw Error('disk unavailable')}
 manager.state.users.owner={}
 const session={userId:'owner',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:['[报告](outputs/report.md)'],items:new Map(),queue:[],reply:async value=>output.push(value)}
 await manager.event(session,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 assert.equal(output[0].errors[0].code,'ARTIFACT_PREPARE_FAILED')
 const transport=new OutputTransport({store:manager.outputStore,send:async()=>{}})
 assert.equal((await transport.deliver('owner',output[0])).status,'partial')
}))
test('fenced examples including unfinished fences never become deliveries',()=>fixture(async({store})=>{
 const text='示例\n~~~md\n[x](outputs/a.md)\n~~~\n```md\n[x](outputs/b.md)'
 assert.equal(await store.package('owner',text),text)
}))
test('partial and cancelled bundles retain all managed originals',()=>fixture(async({store})=>{
 const root=await store.deliveryDirectory('owner'),source=join(root,'report.md');await writeFile(source,'report')
 const partial=await store.package('owner',`[报告](${source}) [缺失](outputs/missing.md)`)
 const transport=new OutputTransport({store,send:async()=>{}})
 assert.equal((await transport.deliver('owner',partial)).status,'partial')
 await access(source)
 const cancelled=await store.package('owner',`[报告](${source})`)
 assert.equal((await transport.deliver('owner',cancelled,{current:()=>false})).status,'cancelled')
 await access(source)
}))
