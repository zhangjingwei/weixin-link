import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SessionManager,controlCommand} from '../../src/wechat/session-manager.mjs'
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'resume-owned-')),calls=[],out=[];let fail=false,gate
 const options={stateDir:dir,cwd:join(dir,'work'),owners:['a','b'],remoteControl:async()=>({stop_confirmed:true}),rpcFactory:()=>({closed:false,write(){},close(){this.closed=true},async request(method,p){calls.push({method,p});if(method==='thread/read')return {thread:{id:p.threadId,cwd:options.cwd,name:'Saved topic',status:{type:'idle'}}};if(method==='thread/resume'){if(p.threadId==='old'&&gate)await gate;if(p.threadId==='old'&&fail)throw Error('Cannot resume');return {thread:{id:p.threadId},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}};if(method==='turn/start')return {turn:{id:'next'}};return {}}})}
 const m=await new SessionManager(options).init();m.state.users={a:{threadId:'current',previous:['old'],hasMessages:true},b:{threadId:'foreign'}};await m.save()
 return {m,calls,out,options,setFail:v=>fail=v,setGate:v=>gate=v,reply:async s=>out.push(s),async close(){m.close();m.memory?.db.close();await rm(dir,{recursive:true,force:true})}}
}
test('explicit commands only; unknown business instructions are not intercepted',()=>{assert.deepEqual(controlCommand('/resume 1'),{action:'resume',selection:'1'});assert.equal(controlCommand('/sessions').action,'sessions');assert.equal(controlCommand('继续上次开发'),null)})
test('owned list selection resumes original ID without a new thread, survives restart, and binds next turn',async()=>{const f=await fixture();try{
 await f.m.handle('a','/sessions',f.reply);assert(f.out.join('').includes('Saved topic'));assert(!f.out.join('').includes('foreign'))
 await f.m.handle('a','/resume 2',f.reply);assert.equal(f.m.state.users.a.threadId,'old');assert(!f.calls.some(c=>c.method==='thread/start'))
 f.m.close();const m=await new SessionManager(f.options).init();try{await m.handle('a','继续',f.reply);assert.equal(f.calls.findLast(c=>c.method==='turn/start').p.threadId,'old')}finally{m.close();}
 }finally{await f.close()}})
test('foreign IDs, missing choices, busy and uncertain queues cannot switch conversations',async()=>{const f=await fixture();try{
 await f.m.handle('a','/resume foreign',f.reply);await f.m.handle('a','/resume 1',f.reply);assert.equal(f.calls.length,0)
 const s=await f.m.connect('a',f.reply);s.busy=true;await f.m.handle('a','/resume old',f.reply);s.busy=false
 f.m.submissions={pending:()=>[{owner:'a'}]};await f.m.handle('a','/resume old',f.reply)
 assert(!f.calls.some(c=>c.method==='thread/resume'&&c.p.threadId==='old'));assert.equal(f.m.state.users.a.threadId,'current')
 }finally{await f.close()}})
test('resume failure and cancellation during resume preserve the current binding',async()=>{const f=await fixture();try{
 f.setFail(true);await f.m.handle('a','/resume old',f.reply);assert.equal(f.m.state.users.a.threadId,'current')
 f.setFail(false);let release;f.setGate(new Promise(r=>release=r));const p=f.m.handle('a','/resume old',f.reply);while(!f.m.sessions.get('a')?.selecting)await new Promise(r=>setTimeout(r,1));f.m.lifecycle.cancel('a');release();await p;assert.equal(f.m.state.users.a.threadId,'current')
 }finally{await f.close()}})
