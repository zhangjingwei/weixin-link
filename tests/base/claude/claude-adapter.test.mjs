import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ClaudeRpc} from '../../../src/base/claude/claude-rpc.mjs'
import {ClaudeConversations} from '../../../src/base/claude/claude-conversations.mjs'
import {SessionManager} from '../../../src/base/codex/codex-session.mjs'
import {validateConfig} from '../../../src/setup/config-schema.mjs'
import {configure} from '../../../src/setup/config-manager.mjs'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'claude-adapter-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const binary=join(dir,'claude'),log=join(dir,'calls.jsonl')
 await writeFile(binary,`#!${process.execPath}\nconst {appendFileSync}=require('node:fs');\nconst args=process.argv.slice(2),index=args.indexOf('--session-id')>=0?args.indexOf('--session-id'):args.indexOf('--resume'),id=args[index+1];let prompt='';process.stdin.on('data',chunk=>prompt+=chunk);process.stdin.on('end',()=>{appendFileSync(process.env.FAKE_CLAUDE_LOG,JSON.stringify({args,id,prompt})+'\\n');console.log(JSON.stringify({type:'system',subtype:'init',session_id:id}));if(prompt.includes('slow'))setTimeout(()=>console.log(JSON.stringify({type:'result',subtype:'success',session_id:id,result:'late'})),30000);else console.log(JSON.stringify({type:'result',subtype:prompt.includes('fail')?'error':'success',is_error:prompt.includes('fail'),session_id:id,result:'Claude reply'}));});\n`)
 await chmod(binary,0o700)
 return {dir,binary,log,env:{...process.env,ANTHROPIC_API_KEY:'test-only',FAKE_CLAUDE_LOG:log}}
}

test('Claude adapter preserves a session across turns and emits shared completion events',async t=>{
 const f=await fixture(t),events=[],rpc=new ClaudeRpc({cwd:f.dir,binary:f.binary,env:f.env,onEvent:event=>events.push(event)})
 const thread=(await rpc.request('thread/start',{developerInstructions:'test policy'})).thread.id
 const wait=()=>new Promise(resolve=>{const timer=setInterval(()=>{if(events.some(e=>e.method==='turn/completed')){clearInterval(timer);resolve()}},5);t.after(()=>clearInterval(timer))})
 await rpc.request('turn/start',{threadId:thread,input:[{type:'text',text:'first'}]});await wait()
 assert.equal(events.find(e=>e.method==='turn/completed').params.turn.status,'completed')
 assert.equal(events.find(e=>e.method==='item/completed').params.item.text,'Claude reply')
 events.length=0
 await rpc.request('turn/start',{threadId:thread,input:[{type:'text',text:'second'}]});await wait()
 const calls=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse)
 assert(calls[0].args.includes('--session-id'));assert(calls[1].args.includes('--resume'))
  assert(calls[0].args.includes('--append-system-prompt-file'))
  assert.equal(calls[0].prompt,'first');assert(!calls[0].args.includes('first'))
 rpc.close()
})

test('Claude failure and stop never produce a successful turn',async t=>{
 const f=await fixture(t),events=[],rpc=new ClaudeRpc({cwd:f.dir,binary:f.binary,env:f.env,onEvent:event=>events.push(event)})
 const thread=(await rpc.request('thread/start',{})).thread.id
 const wait=()=>new Promise(resolve=>{const timer=setInterval(()=>{if(events.some(e=>e.method==='turn/completed')){clearInterval(timer);resolve()}},5);t.after(()=>clearInterval(timer))})
 await rpc.request('turn/start',{threadId:thread,input:[{type:'text',text:'fail'}]});await wait()
 assert.equal(events.at(-1).params.turn.status,'failed')
 events.length=0
 const turn=(await rpc.request('turn/start',{threadId:thread,input:[{type:'text',text:'slow'}]})).turn.id
 await new Promise(resolve=>{const timer=setInterval(()=>{if(events.some(e=>e.method==='turn/started')){clearInterval(timer);resolve()}},5);t.after(()=>clearInterval(timer))})
 await rpc.request('turn/interrupt',{threadId:thread,turnId:turn});await wait()
 assert.equal(events.at(-1).params.turn.status,'interrupted')
 rpc.close()
})

test('shared session manager runs a Claude turn through the adapter',async t=>{
 const f=await fixture(t),manager=await new SessionManager({stateDir:join(f.dir,'state'),cwd:f.dir,owners:['owner'],agentKind:'claude',remoteControl:async()=>({stop_confirmed:true,tasks:[]}),rpcFactory:options=>new ClaudeRpc({...options,binary:f.binary,env:f.env})}).init()
 t.after(()=>manager.close())
 const output=[],result=await manager.ask('owner','hello',text=>output.push(text))
 assert.equal(result.status,'completed');assert.match(result.reply,/Claude reply/)
 assert(output.some(text=>String(text).includes('Claude reply')))
})

test('installation selects Claude only with an absolute CLI path',()=>{
 assert.throws(()=>validateConfig('installation',{workspace:'/tmp/work',agentBackend:'claude'}),/CONFIG_REQUIRED_FIELD/)
 assert.equal(validateConfig('installation',{workspace:'/tmp/work',agentBackend:'claude',claudeBinary:'/usr/local/bin/claude'}).agentBackend,'claude')
})

test('Claude navigation stays local and refuses permanent deletion',async t=>{
 const f=await fixture(t),manager=await new SessionManager({stateDir:join(f.dir,'state'),cwd:f.dir,owners:['owner'],agentKind:'claude',rpcFactory:options=>new ClaudeRpc({...options,binary:f.binary,env:f.env})}).init()
 t.after(()=>manager.close())
 const conversations=new ClaudeConversations(manager,['owner']),output=[]
 const message=conversations.bind({userId:'owner',text:'新建 项目'})
 assert.equal(await conversations.control(message,text=>output.push(text)),true)
 assert.equal(conversations.ensure('owner').entries.length,2)
 assert.match(output.at(-1),/Claude 会话2/)
 await conversations.control(conversations.bind({userId:'owner',text:'列表'}),text=>output.push(text))
 assert.match(output.at(-1),/^项目列表\n2\./)
 assert(!output.at(-1).includes('1. 原有对话'))
 const deletion=conversations.bind({userId:'owner',text:'删除2'})
 await conversations.control(deletion,text=>output.push(text))
 assert.match(output.at(-1),/未修改会话或历史/)
 assert.equal(conversations.ensure('owner').entries[1].deleted,undefined)
})

test('installation configuration verifies Claude CLI and writes Claude workspace guidance',async t=>{
 const f=await fixture(t),workspace=join(f.dir,'workspace'),binary=join(f.dir,'version-claude')
 await (await import('node:fs/promises')).mkdir(workspace)
 await writeFile(binary,`#!${process.execPath}\nconsole.log('2.1.258')\n`);await chmod(binary,0o700)
 const config={workspace,agentBackend:'claude',claudeBinary:binary}
 await assert.rejects(configure('installation',config,{home:f.dir}),/CONFIG_CONNECTION_CHECK_FAILED/)
 await writeFile(binary,`#!${process.execPath}\nconsole.log('2.1.259')\n`)
 const result=await configure('installation',config,{home:f.dir})
 assert.equal(result.written,true)
 assert.match(await readFile(join(workspace,'AGENTS.md'),'utf8'),/Claude 可执行路径/)
})
