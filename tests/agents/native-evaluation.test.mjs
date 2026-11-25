import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeScenario} from '../../src/tools/eval-native-agent.mjs'

test('evaluation counts only final replies from the matching native session and turn',async()=>{
 let rpc,closed=false
 const protocol={
  createRpc:options=>(rpc={...options,close(){closed=true}}),
  initialize:async()=>{},open:async()=>({thread:{id:'session'}}),read:async()=>({id:'session'}),
  input:value=>value,
  async startTurn(){
   for(const [threadId,turnId,phase,text] of [['other','turn','final_answer','foreign'],['session','old','final_answer','stale'],['session','turn','commentary','progress'],['session','turn','final_answer','answer']]){
    rpc.onEvent({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',phase,text}}})
   }
   rpc.onEvent({method:'turn/completed',params:{threadId:'session',turn:{id:'turn',status:'completed'}}})
   return {turn:{id:'turn'}}
  }
 }
 assert.deepEqual(await nativeScenario(protocol,{steps:[{prompt:'question'}]}),['answer'])
 assert.equal(closed,true)
})
