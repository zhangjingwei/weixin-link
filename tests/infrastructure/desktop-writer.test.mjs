import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {desktopWriter} from '../../src/infrastructure/agents/desktop-writer.mjs'

test('normal quit targets only the previously identified desktop process',async t=>{
 const home=await mkdtemp(join(tmpdir(),'writer-'))
 t.after(()=>rm(home,{recursive:true,force:true}))
 const thread={id:'thread',path:join(home,'sessions','rollout-thread.jsonl')}
 await mkdir(join(home,'sessions'));await writeFile(thread.path,'')
 let writer='12',quit=0
 const run=async(cmd,args)=>{
  if(cmd==='/usr/sbin/lsof'){
   if(!writer)throw Object.assign(Error(),{code:1,stdout:'',stderr:''})
   return {stdout:'p'+writer+'\nau\n'}
  }
  if(cmd==='/bin/ps')return {stdout:writer+' 11 /Applications/ChatGPT.app/Contents/Resources/codex\n11 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT'}
  assert.equal(cmd,'/usr/bin/osascript');assert.deepEqual(args.slice(-2),['11','/Applications/ChatGPT.app'])
  quit++;writer=null
 }
 const adapter=desktopWriter({codexHome:home,platform:'darwin',run}),target=await adapter.inspect(thread)
 writer='14'
 await assert.rejects(adapter.release(thread,target,()=>true),/WRITER_CHANGED/)
 assert.equal(quit,0)
 writer='12';await adapter.release(thread,target,()=>true);assert.equal(quit,1)
})
