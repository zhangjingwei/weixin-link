import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
export async function setupModelTest(manager,{signal,executionKey,reply,timeout=120000,stopWait=10000}){
 const previous=manager.sessions.get(executionKey)
 if(!executionKey||previous?.busy||previous?.finishing||previous?.connecting||previous?.queue?.length)throw Error('CURRENT_TASK_BUSY')
 const probeKey='codex-probe-'+randomUUID()
 const prompt='这是连接测试。不要调用工具，只回复“连接成功”。测试编号：'+randomUUID()
 manager.owners?.add(probeKey)
 const base=manager.lifecycle.capture(probeKey),local=new AbortController()
 const token={...base,current:()=>base.current()&&!signal?.aborted&&!local.signal.aborted,signal:signal?AbortSignal.any([signal,local.signal]):local.signal}
 let stopping
 const stop=()=>stopping??=(async()=>{const session=manager.sessions.get(probeKey);if(session?.requestText!==prompt||!session.busy)return;await manager.interrupt(session);const until=Date.now()+stopWait;while(session.busy&&session.requestText===prompt&&Date.now()<until)await delay(50);if(session.busy&&session.requestText===prompt)throw Error('MODEL_TEST_STOP_UNCONFIRMED')})()
 const abort=()=>{local.abort();void stop().catch(()=>{})}
 signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true})
 try{const result=await manager.ask(probeKey,prompt,async()=>{},timeout,token);signal?.throwIfAborted();if(result.status!=='completed'||!String(result.reply??'').includes('连接成功'))throw Error('MODEL_TEST_FAILED');return result}
 catch(error){local.abort();await stop();throw error}
 finally{
  signal?.removeEventListener('abort',abort);if(stopping)await stopping
  const session=manager.sessions.get(probeKey)
  if(session&&!session.busy){manager.detachRpc?.(session,session.rpcAttempt);manager.sessions.delete(probeKey)}
  if(!session?.busy){if(manager.state?.users)delete manager.state.users[probeKey];manager.owners?.delete(probeKey);await manager.save?.()}
 }
}
