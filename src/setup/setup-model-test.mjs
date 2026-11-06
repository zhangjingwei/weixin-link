import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
export async function setupModelTest(manager,{signal,executionKey,reply,timeout=120000,stopWait=10000}){
 const previous=manager.sessions.get(executionKey)
 if(!executionKey||previous?.busy||previous?.finishing||previous?.connecting||previous?.queue?.length)throw Error('CURRENT_TASK_BUSY')
 const prompt='这是用户主动选择的安装验收测试，请只回复“连接成功”，不要调用工具。测试编号：'+randomUUID()
 const base=manager.lifecycle.capture(executionKey),local=new AbortController()
 const token={...base,current:()=>base.current()&&!signal?.aborted&&!local.signal.aborted,signal:signal?AbortSignal.any([signal,local.signal]):local.signal}
 let stopping
 const stop=()=>stopping??=(async()=>{const session=manager.sessions.get(executionKey);if(session?.requestText!==prompt||!session.busy)return;await manager.interrupt(session);const until=Date.now()+stopWait;while(session.busy&&session.requestText===prompt&&Date.now()<until)await delay(50);if(session.busy&&session.requestText===prompt)throw Error('MODEL_TEST_STOP_UNCONFIRMED')})()
 const abort=()=>{local.abort();void stop().catch(()=>{})}
 signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true})
 try{const result=await manager.ask(executionKey,prompt,reply,timeout,token);signal?.throwIfAborted();if(result.status!=='completed')throw Error('MODEL_TEST_FAILED');return result}
 catch(error){local.abort();await stop();throw error}
 finally{signal?.removeEventListener('abort',abort);if(stopping)await stopping}
}
