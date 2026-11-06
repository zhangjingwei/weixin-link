import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionManager,codexFallbackProviderOptions,isProviderAvailabilityFailure,DEEPSEEK_FALLBACK_NOTICE} from '../../../src/base/codex/codex-session.mjs'
import {DurableJobs} from '../../../src/core/durable-jobs.mjs'

const fallbackEnv={
  WECHAT_CODEX_FALLBACK_PROVIDER:'deepseek_test',
  WECHAT_CODEX_FALLBACK_MODEL:'deepseek-flash',
  WECHAT_CODEX_FALLBACK_BASE_URL:'https://api.deepseek.com',
  WECHAT_CODEX_FALLBACK_REASONING_EFFORT:'high',
  WECHAT_CODEX_FALLBACK_WEB_SEARCH:'disabled',
}

function rpcError(message,{definitive=true,code=-32000}={}) {
  return Object.assign(new Error(message),{definitiveRpcError:definitive,rpcCode:code})
}

function mockRpc({provider,onEvent,onClose,handler}) {
  return {
    provider,closed:false,calls:[],
    async request(method,params){this.calls.push({method,params});if(method==='thread/memoryMode/set')return {};return handler(this,method,params)},
    write(){},respond(){},
    close(){if(!this.closed){this.closed=true;onClose()}},
    event(message){return onEvent(message)},
  }
}

async function finishTurn(rpc,threadId,text,turnId='turn-1'){
  await rpc.event({method:'item/completed',params:{threadId,turnId,item:{id:'answer',type:'agentMessage',phase:'final_answer',text}}})
  await rpc.event({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}})
}

test('fallback profile is separate from the default GPT profile',()=>{
  const options=codexFallbackProviderOptions(fallbackEnv)
  assert.deepEqual(options.thread,{model:'deepseek-flash',modelProvider:'deepseek_test',reasoningEffort:'high'})
  assert.ok(options.args.includes('web_search="disabled"'))
  assert.equal(codexFallbackProviderOptions({}),null)
  assert.equal(isProviderAvailabilityFailure(rpcError('model gpt-overseas is not available'),{stage:'turn'}),true)
  assert.equal(isProviderAvailabilityFailure(rpcError('invalid params'),{stage:'turn'}),false)
})


test('a DeepSeek thread on disk does not force GPT down; the primary starts a fresh compatible thread',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-thread-migration-')),output=[],clients=[],events=[]
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:fallbackEnv,log:(event,fields)=>events.push({event,fields}),rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/resume')throw rpcError('failed to load configuration: Model provider `deepseek_test` not found',{code:-32600})
        if(method==='thread/start')return {thread:{id:'thread-gpt-fresh'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start'){
          queueMicrotask(async()=>{
            await rpc.event({method:'turn/started',params:{threadId:'thread-gpt-fresh',turn:{id:'turn-gpt-fresh'}}})
            await rpc.event({method:'item/started',params:{threadId:'thread-gpt-fresh',turnId:'turn-gpt-fresh',item:{id:'answer',type:'agentMessage',phase:'final_answer'}}})
          })
          return {turn:{id:'turn-gpt-fresh'}}
        }
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    manager.state.users.owner={threadId:'thread-deepseek-old',previous:['older-thread'],hasMessages:true}
    await manager.save()
    try{
      await manager.handle('owner','旧线程兼容测试',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary'])
      assert.equal(clients[0].calls.filter(call=>call.method==='thread/resume').length,1)
      assert.equal(clients[0].calls.filter(call=>call.method==='thread/start').length,1)
      assert.equal(manager.state.users.owner.threadId,'thread-gpt-fresh')
      assert.deepEqual(manager.state.users.owner.previous,['older-thread','thread-deepseek-old'])
      assert.ok(events.some(x=>x.event==='provider.thread_incompatible'))
      await finishTurn(clients[0],'thread-gpt-fresh','GPT 新线程完成。','turn-gpt-fresh')
      assert.equal(output.at(-1),'GPT 新线程完成。')
    }finally{manager.close();await manager.saving}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('primary connection failure switches to DeepSeek once and labels the result',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-connect-fallback-')),output=[],clients=[]
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:fallbackEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start'){
          if(rpc.provider==='primary')throw rpcError('model gpt-overseas is not available')
          return {thread:{id:'thread-fallback'},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        }
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start')return {turn:{id:'turn-1'}}
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      await manager.handle('owner','测试主模型不可用',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback'])
      assert.equal(clients[0].calls.some(call=>call.method==='turn/start'),false)
      assert.equal(clients[1].calls.some(call=>call.method==='turn/start'),true)
      await finishTurn(clients[1],'thread-fallback','已由备用模型完成。')
      assert.ok(output.includes('已由备用模型完成。\n\n'+DEEPSEEK_FALLBACK_NOTICE))
      assert.ok(output.every(text=>!text.includes('连接中断')))
    }finally{manager.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('turn/start availability error switches provider without retrying a generic task error',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-turn-fallback-')),output=[],clients=[]
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:fallbackEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-primary'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start'){
          if(rpc.provider==='primary')throw rpcError('model gpt-overseas is not available')
          return {turn:{id:'turn-1'}}
        }
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      await manager.handle('owner','继续原任务',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback'])
      assert.equal(clients[0].calls.filter(call=>call.method==='turn/start').length,1)
      assert.equal(clients[1].calls.filter(call=>call.method==='turn/start').length,1)
      await finishTurn(clients[1],'thread-primary','备用模型结果。')
      assert.ok(output.at(-1).endsWith(DEEPSEEK_FALLBACK_NOTICE))
    }finally{manager.close()}

    const genericOutput=[],genericClients=[]
    const genericManager=await new SessionManager({stateDir:join(dir,'generic'),cwd:dir,owners:['owner'],providerEnv:fallbackEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-generic'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start')throw rpcError('invalid params',{code:-32602})
        throw Error('unexpected '+method)
      }})
      genericClients.push(client)
      return client
    }}).init()
    try{
      await genericManager.handle('owner','普通失败不降级',async text=>genericOutput.push(text))
      assert.deepEqual(genericClients.map(client=>client.provider),['primary'])
      assert.ok(genericOutput.some(text=>text.includes('invalid params')))
      assert.ok(genericOutput.every(text=>!text.includes(DEEPSEEK_FALLBACK_NOTICE)))
    }finally{genericManager.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('a GPT turn that never starts after turn/start is acknowledged switches once',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-start-timeout-')),output=[],clients=[]
  const providerEnv={...fallbackEnv,WECHAT_CODEX_PRIMARY_START_TIMEOUT_MS:'20'}
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-timeout'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start')return {turn:{id:'turn-timeout'}}
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      await manager.handle('owner','超时后切换',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback'])
      assert.equal(clients[0].closed,true)
      assert.equal(clients[0].calls.filter(call=>call.method==='turn/start').length,1)
      assert.equal(clients[1].calls.filter(call=>call.method==='turn/start').length,1)
      await finishTurn(clients[1],'thread-timeout','超时任务由备用模型完成。','turn-timeout')
      assert.ok(output.at(-1).includes(DEEPSEEK_FALLBACK_NOTICE))
    }finally{manager.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})



test('an accepted GPT turn is not downgraded just because model output is delayed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-delayed-output-')),output=[],clients=[]
  const providerEnv={...fallbackEnv,WECHAT_CODEX_PRIMARY_START_TIMEOUT_MS:'1000'}
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-delayed'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start'){
          if(rpc.provider==='primary'){
            queueMicrotask(async()=>{
              await rpc.event({method:'turn/started',params:{threadId:'thread-delayed',turn:{id:'turn-primary-delayed'}}})
              await rpc.event({method:'item/started',params:{threadId:'thread-delayed',turnId:'turn-primary-delayed',item:{id:'user',type:'userMessage'}}})
              await rpc.event({method:'item/completed',params:{threadId:'thread-delayed',turnId:'turn-primary-delayed',item:{id:'user',type:'userMessage'}}})
            })
            return {turn:{id:'turn-primary-delayed'}}
          }
          return {turn:{id:'turn-fallback-delayed'}}
        }
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      await manager.handle('owner','GPT 长推理等待测试',async text=>output.push(text))
      await new Promise(resolve=>setTimeout(resolve,50))
      assert.deepEqual(clients.map(client=>client.provider),['primary'])
      assert.equal(clients[0].closed,false)
      await finishTurn(clients[0],'thread-delayed','GPT 延迟后完成。','turn-primary-delayed')
      assert.equal(output.at(-1),'GPT 延迟后完成。')
      assert.ok(output.every(text=>!text.includes(DEEPSEEK_FALLBACK_NOTICE)))
    }finally{manager.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('a fallback turn retries GPT before the next user message and returns to primary when recovered',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-primary-retry-')),output=[],clients=[],events=[]
  let primaryTurnAttempts=0
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv:fallbackEnv,log:(event,fields)=>events.push({event,fields}),rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-retry'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:rpc.provider==='primary'?'gpt-overseas':'deepseek-flash',modelProvider:rpc.provider==='primary'?'openai':'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start'){
          if(rpc.provider==='primary'){
            primaryTurnAttempts++
            if(primaryTurnAttempts===1)throw rpcError('model gpt-overseas is temporarily unavailable')
            queueMicrotask(()=>rpc.event({method:'turn/started',params:{threadId:'thread-retry',turn:{id:'turn-primary-recovered'}}}))
            return {turn:{id:'turn-primary-recovered'}}
          }
          return {turn:{id:'turn-fallback-first'}}
        }
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      await manager.handle('owner','第一轮降级',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback'])
      await finishTurn(clients[1],'thread-retry','第一轮由备用模型完成。','turn-fallback-first')
      assert.ok(output.at(-1).includes(DEEPSEEK_FALLBACK_NOTICE))

      await manager.handle('owner','第二轮应恢复主模型',async text=>output.push(text))
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback','primary'])
      assert.equal(clients[1].closed,true)
      await finishTurn(clients[2],'thread-retry','第二轮已恢复 GPT。','turn-primary-recovered')
      assert.equal(output.at(-1),'第二轮已恢复 GPT。')
      assert.ok(events.some(item=>item.event==='provider.primary_recovered'))
    }finally{manager.close();await manager.saving}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('a terminal provider event before turn/started switches without waiting for the timeout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-event-fallback-')),output=[],clients=[]
  const providerEnv={...fallbackEnv,WECHAT_CODEX_PRIMARY_START_TIMEOUT_MS:'5000'}
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-event'},model:'gpt-overseas',modelProvider:'openai',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start'){
          if(rpc.provider==='primary'){
            queueMicrotask(()=>rpc.event({method:'error',params:{threadId:'thread-event',codexErrorInfo:{responseStreamConnectionFailed:{httpStatusCode:503}},willRetry:false}}))
            return {turn:{id:'turn-primary-event'}}
          }
          return {turn:{id:'turn-fallback-event'}}
        }
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    try{
      const started=Date.now()
      await manager.handle('owner','事件失败后切换',async text=>output.push(text))
      assert.ok(Date.now()-started<2000)
      assert.deepEqual(clients.map(client=>client.provider),['primary','fallback'])
      await finishTurn(clients[1],'thread-event','由备用模型恢复。','turn-fallback-event')
      assert.ok(output.at(-1).includes(DEEPSEEK_FALLBACK_NOTICE))
    }finally{manager.close()}
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('an uncertain accepted primary turn is retargeted to the fallback turn in the durable ledger',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-ledger-fallback-')),output=[],clients=[]
  const jobs=new DurableJobs(join(dir,'jobs.sqlite'))
  const providerEnv={...fallbackEnv,WECHAT_CODEX_PRIMARY_START_TIMEOUT_MS:'20'}
  try{
    const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['owner'],providerEnv,rpcFactory:args=>{
      const client=mockRpc({...args,handler:async(rpc,method,params)=>{
        if(method==='initialize')return {}
        if(method==='thread/start')return {thread:{id:'thread-ledger'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='thread/resume')return {thread:{id:params.threadId},model:'deepseek-flash',modelProvider:'deepseek_test',sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}
        if(method==='turn/start')return {turn:{id:rpc.provider==='primary'?'turn-primary-ledger':'turn-fallback-ledger'}}
        throw Error('unexpected '+method)
      }})
      clients.push(client)
      return client
    }}).init()
    manager.submissions=jobs
    const id=jobs.add('owner',{text:'账本切换测试'},'ledger-key')
    try{
      await manager.handle('owner',{text:'账本切换测试',deliveryId:id},async text=>output.push(text))
      const job=jobs.get(id)
      assert.equal(job.state,'submitted')
      assert.equal(job.turn_id,'turn-fallback-ledger')
      assert.equal(manager.state.users.owner.recovery.execution,'running')
      await finishTurn(clients[1],'thread-ledger','账本已切换。','turn-fallback-ledger')
      assert.ok(output.at(-1).includes(DEEPSEEK_FALLBACK_NOTICE))
    }finally{manager.close();await manager.saving}
  }finally{jobs.close();await rm(dir,{recursive:true,force:true})}
})
