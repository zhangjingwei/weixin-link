import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DurableIntake} from '../../src/application/tasks/durable-intake.mjs'
import {CancellationScopes} from '../../src/infrastructure/runtime/cancellation-scopes.mjs'
for(const config of ['{invalid json',JSON.stringify({hosts:[{id:'wrong-host',aliases:['开发机']}],projects:[{id:'wrong-project',aliases:['演示项目'],host:'wrong-host',path:'/wrong/path'}]})]){
 for(const structured of [false,true])test('legacy project config cannot rewrite or block '+(structured?'structured':'text')+' requests ('+(config[0]==='{'&&config.includes('invalid')?'invalid':'valid')+')',async()=>{
  const root=await mkdtemp(join(tmpdir(),'original-request-'))
  try{
   await writeFile(join(root,'targets.json'),config)
   const text='  请在开发机核实演示项目的位置\n保留这一行和末尾空白  ',original=structured?{text,attachments:[{path:'/original/document',kind:'files'}],references:[{text:'original reference'}]}:text
   const job={id:'delivery-id',owner:'owner',state:'pending',input:original},pending=[job],seen=[],states=[]
   const jobs={pending:()=>pending,mark(id,state){states.push(state);pending.splice(0)}}
   const manager={cwd:root,lifecycle:new CancellationScopes(),sessions:new Map(),state:{users:{owner:{}}},async ask(owner,input){seen.push({owner,input})}}
   const intake=new DurableIntake({jobs,manager,reply:async()=>{}})
   await intake.pump('owner');intake.close()
   assert.equal(seen.length,1);assert.equal(seen[0].input.text,text);assert.equal(seen[0].input.deliveryId,'delivery-id');assert.deepEqual(states,['done'])
   if(structured){assert.deepEqual(seen[0].input.attachments,original.attachments);assert.deepEqual(seen[0].input.references,original.references);assert.equal(original.deliveryId,undefined)}
   else assert.equal(job.input,text)
  }finally{await rm(root,{recursive:true,force:true})}
 })
}
