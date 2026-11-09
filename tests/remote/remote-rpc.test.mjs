import './remote-test-config.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {RemoteRpc} from '../../src/remote/remote-rpc.mjs'
const failure=()=>Error('REMOTE_DISCONNECTED')
function fixture(handler,extra={}){const transports=[],calls=[];const rpc=new RemoteRpc('spark',{retryDelays:[1,1],...extra,transportFactory:(host,options)=>{const t={closed:false,async connect(){calls.push(['connect',transports.indexOf(t)]);return handler?.('connect',{},t)},send(message){if(!message.method)return;const m=message.method,p=message.params;calls.push([m,p]);const result=m==='thread/resume'?{thread:{id:p.threadId,cwd:'/project'}}:handler?.(m,p,t)??{ok:true};if(message.id!==undefined)queueMicrotask(()=>t.onMessage({id:message.id,result}))},close(){if(!this.closed){this.closed=true;options.onDisconnect()}},drop(){this.close()}};transports.push(t);return t}});return {rpc,transports,calls}}
test('disconnected read reconnects, resumes exact thread, and reissues once',async()=>{let count=0;const f=fixture(m=>{if(m==='thread/read'&&count++===0)throw failure()});f.rpc.setRecovery({taskId:'task',threadId:'thread',cwd:'/project'});try{await f.rpc.call('thread/read',{threadId:'thread'});assert.equal(f.transports.length,2);assert.equal(f.calls.filter(([m])=>m==='thread/resume').length,2);assert.equal(f.calls.filter(([m])=>m==='thread/read').length,2)}finally{f.rpc.close()}})
test('uncertain turn/start is never replayed',async()=>{const f=fixture(m=>{if(m==='turn/start')throw failure()});try{await assert.rejects(f.rpc.call('turn/start',{}),/REQUEST_UNCERTAIN/);assert.equal(f.calls.filter(([m])=>m==='turn/start').length,1)}finally{f.rpc.close()}})
test('concurrent reads share one initial connection',async()=>{const f=fixture();try{await Promise.all([f.rpc.call('thread/list'),f.rpc.call('thread/read')]);assert.equal(f.transports.length,1)}finally{f.rpc.close()}})
test('idle disconnect reconnects automatically; explicit close does not',async()=>{const f=fixture();await f.rpc.connect();f.transports[0].drop();await new Promise(r=>setTimeout(r,20));assert.equal(f.transports.length,2);f.rpc.close();await new Promise(r=>setTimeout(r,20));assert.equal(f.transports.length,2);await assert.rejects(f.rpc.connect(),/REMOTE_CLOSED/)})
test('reconnect attempts are bounded',async()=>{const f=fixture(m=>{if(m==='connect')throw failure()});try{await assert.rejects(f.rpc.connect(),/EXHAUSTED/);assert.equal(f.transports.length,3)}finally{f.rpc.close()}})
test('RPC application errors are not retried',async()=>{const f=fixture(m=>{if(m==='thread/read')throw Error('REMOTE_RPC_ERROR')});try{await assert.rejects(f.rpc.call('thread/read'),/REMOTE_RPC_ERROR/);assert.equal(f.transports.length,1)}finally{f.rpc.close()}})
test('default transport and reconnect use the RPC host snapshot',()=>{
 const config={platform:'posix',binary:'/opt/codex',root:'/home/example/work',transport:'daemon-proxy'}
 const rpc=new RemoteRpc('spark',{hostConfig:config})
 config.root='/other'
 const first=rpc.connection.transportFactory({}),second=rpc.connection.transportFactory({})
 assert.equal(first.config.root,'/home/example/work')
 assert.equal(second.config.root,'/home/example/work')
 assert.equal(Object.isFrozen(rpc.hostConfig),true)
 rpc.close()
})
