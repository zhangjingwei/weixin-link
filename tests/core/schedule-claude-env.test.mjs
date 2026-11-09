import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ClaudeRpc} from '../../src/base/claude/claude-rpc.mjs'

test('Claude turn exposes only its own conversation ID to the schedule command',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'schedule-claude-env-'))
 t.after(()=>rm(stateDir,{recursive:true,force:true}))
 let spawned,child
 const rpc=new ClaudeRpc({cwd:stateDir,stateDir,binary:'claude',env:{ANTHROPIC_API_KEY:'test'},spawnProcess:(_binary,_args,options)=>{
  spawned=options
  child=new EventEmitter()
  child.stdin=new EventEmitter();child.stdin.end=()=>{}
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{}
  return child
 }})
 const first=(await rpc.request('thread/start')).thread.id
 await rpc.request('turn/start',{threadId:first,input:[{type:'text',text:'first'}]})
 assert.equal(spawned.env.WECHAT_CONVERSATION_ID,first)
 child.emit('close',0)
 const second=(await rpc.request('thread/start')).thread.id
 await rpc.request('turn/start',{threadId:second,input:[{type:'text',text:'second'}]})
 assert.equal(spawned.env.WECHAT_CONVERSATION_ID,second)
 assert.notEqual(first,second)
 rpc.close()
})
