import {selectionRequest,offerAgents} from './executor-selection.mjs'
import {randomBytes} from 'node:crypto'
import {validateProjectTask} from './project-dispatch.mjs'
import {enqueueDuringTurn,awaitNativeTurn,cancelNativeWaiting} from './native-queue.mjs'
import {recover} from './local-recovery.mjs'
import {localTaskLabel} from '../../domain/tasks/task-label.mjs'
import {setTimeout as delay} from 'node:timers/promises'
export class DurableIntake {
 constructor({jobs,manager,reply,conversations,desktopWriter,log=()=>{}}){Object.assign(this,{jobs,manager,reply,conversations,desktopWriter,log});this.users=new Map();this.closed=false}
 submit(owner,input,key,ingressIds=[]){
  input=typeof input==='string'?{text:input}:input
  const bound=this.manager.agentFor?.(owner)
  const control=!bound&&this.manager.protocol?.availableAgents&&!input.agentKind&&!input.nativeCommand&&!input.projectDispatch&&!input.internalHandoff&&!input.attachments?.length&&!input.images?.length&&!input.audios?.length&&selectionRequest(input.text)
  if(control)input={...input,agentSelection:true,agentKind:control.kind}
  const handoff=this.jobs.pending().filter(job=>job.owner===owner&&(job.input?.internalHandoff||job.input?.agentSelection&&job.input.agentKind)).at(-1)
  input={...input,agentKind:control?control.kind:input.agentKind??handoff?.input.agentKind??bound??null}
  if(handoff?.input.agentSelection&&!control&&!input.internalHandoff&&!input.projectDispatch&&input.agentKind===handoff.input.agentKind)input={...input,dependencies:[...new Set([...(input.dependencies??[]),handoff.id])]}
  const executorId=input.agentKind&&this.manager.protocol?.forAgent?.(input.agentKind)?.executorId
  if(executorId)input.executorId=executorId
  const id=this.jobs.add(owner,input,key,ingressIds)
  enqueueDuringTurn(this,owner,this.jobs.get?.(id)?.input??input,id);this.wake(owner);return id
 }
 async quitDesktop(message,reply){
  const owner=message.userId,{threadId}=message._desktopQuit
  const current=()=>!this.closed&&!!threadId&&this.manager.state.users[owner]?.threadId===threadId
  if(!current()){await reply('当前微信会话没有可核对的桌面连接。');return}
  let target
  try{
   const entry=this.conversations.entry(owner)
   const thread=await this.conversations.withBackend(entry.owner,rpc=>this.conversations.backendPort.readConversation(rpc,threadId))
   if(thread?.id!==threadId||!current())throw Error('DESKTOP_THREAD_CHANGED')
   target=await this.desktopWriter.inspect(thread)
   if(target)await this.desktopWriter.release(thread,target,current)
  }catch{await reply('未能确认桌面应用已释放这条会话，请在电脑上查看。');return}
  if(!current())return
  const choices=this.jobs.desktopChoices(owner,threadId)
  const text=target?'已请求退出 '+target.app+'，已确认它释放了这条会话。':'当前没有桌面应用占用这条会话。'
  if(!this.manager.state.desktopHandoff&&choices.length===1){
   const job=this.jobs.desktopJob(owner,choices[0])
   if(job&&this.jobs.retryAfterDesktop(owner,job.id,choices[0])){
    this.wake(owner)
    await reply(text+'正在继续处理原消息。');return
   }
  }
  await reply(text+(this.manager.state.desktopHandoff?'回复“回到微信继续”可以接续。':choices.length?'回复“继续”选择要处理的消息。':''))
 }
 async offerDesktop(job,threadId,reply){
  if(!threadId||this.manager.state?.users[job.owner]?.threadId!==threadId)return false
  const code=randomBytes(4).toString('hex')
  if(!this.jobs.waitForDesktop(job.owner,job.id,{threadId,code}))return true
  await reply('已在另一个应用中打开。请先在那边关闭会话，才能在这里继续。原消息已保留，关闭后回复“继续”即可。也可以回复“关闭桌面端”，让微信退出占用它的桌面应用（包括其他窗口）。回复“取消”可放弃原消息。')
  return true
 }
 async confirmDesktop(message,action,code,reply){
  const owner=message.userId,job=this.jobs.desktopJob(owner,code)
  if(message._ingressId)this.jobs.acknowledge([message._ingressId])
  if(!job){await reply('这项确认已经失效。');return}
  if(action==='取消'){this.jobs.mark(job.id,'cancelled');await reply('已取消这条保留的消息。');return}
  if(this.closed||this.manager.state.desktopHandoff||this.manager.state.users[owner]?.threadId!==job.context.desktopConfirmation.threadId){await reply('原会话状态已变化，消息仍保留。');return}
  if(this.jobs.retryAfterDesktop(owner,job.id,code))this.wake(owner)
 }
 cancel(owner,{queueAlreadyCancelled=false}={}){
  if(!queueAlreadyCancelled)this.jobs.cancel(owner)
  if(!this.closed)void cancelNativeWaiting(this,owner).catch(()=>this.log('queue.native_stop_unconfirmed',{}))
 }
 resume(){for(const owner of new Set(this.jobs.pending().map(j=>j.owner)))if(this.manager.owners.has(owner))this.wake(owner)}
 wake(owner){if(this.closed||this.manager.state?.desktopHandoff||this.manager.desktopTransition||this.users.has(owner))return;const run=this.pump(owner).catch(e=>this.log('queue.failed',{code:e.code??'WORKER_FAILED'})).finally(()=>{this.users.delete(owner);if(!this.closed&&!this.manager.state?.desktopHandoff&&!this.manager.desktopTransition&&this.jobs.pending().some(j=>j.owner===owner))queueMicrotask(()=>this.wake(owner))});this.users.set(owner,run)}
 next(owner){
  const jobs=this.jobs.pending().filter(job=>job.owner===owner)
  const active=jobs.find(job=>job.state!=='pending');if(active)return active
  return jobs.find(job=>job.state!=='pending'||!(job.input?.dependencies??[]).some(id=>{const prior=this.jobs.get(id);return prior&&!['done','cancelled','uncertain'].includes(prior.state)}))??jobs[0]
 }
 async pump(owner){
  for(;;){if(this.closed||this.manager.state?.desktopHandoff||this.manager.desktopTransition)return;const job=this.next(owner);if(!job)return;const token=this.manager.lifecycle.capture(owner),reply=(v,o)=>this.reply(owner,v,{...o,...job.input?.projectDispatch?{projectTaskId:job.id}:{},traceId:o?.traceId??(typeof job.input==='object'?job.input.traceId:undefined)})
   let executionStarted=false
   try{
    if(job.input?.executorId&&job.input.executorId!==this.manager.protocol?.forAgent?.(job.input.agentKind)?.executorId){
     this.jobs.mark(job.id,job.state==='pending'?'cancelled':'uncertain')
     await reply('原执行器的路径或配置目录已变化。请核对原会话和任务记录。')
     continue
    }
    if(job.state==='pending'){
     const input=typeof job.input==='string'?{text:job.input}:{...job.input};input.deliveryId=job.id
     if(job.context?.desktopConfirmation)input.expectedThreadId=job.context.desktopConfirmation.threadId
     const session=this.manager.sessions?.get(owner)
     if(session?.busy||session?.finishing)this.log('queue.waiting_session',{trace_id:input.traceId})
     while(this.manager.sessions?.get(owner)?.busy||this.manager.sessions?.get(owner)?.finishing){if(this.closed||!token.current())return;await delay(100)}
     if(this.closed||!token.current()||this.manager.state?.desktopHandoff||this.manager.desktopTransition)return
     if((this.jobs.get?this.jobs.get(job.id):job)?.state!=='pending'||this.next(owner)?.id!==job.id)continue
     validateProjectTask(this,job)
     const dependencies=job.input?.dependencies??[]
     const prerequisites=dependencies.map(id=>this.jobs.get(id))
     if(prerequisites.some(prior=>!prior||['cancelled','uncertain'].includes(prior.state)||prior.state==='done'&&prior.outcome!=='completed')){this.jobs.mark(job.id,'cancelled');await reply('前置任务未确认成功，依赖任务未执行。');continue}
     if(prerequisites.some(prior=>prior.state!=='done')){await delay(100);continue}
     if(input.agentSelection){
      if(input.selectionTask&&!this.manager.protocol.availableAgents.includes(input.agentKind)){
       this.jobs.markOutcome?.(job.id,'not_submitted');this.jobs.mark(job.id,'cancelled');await reply(input.agentKind+' 未接入，本条任务未提交。可用执行器：'+(this.manager.protocol.availableAgents.join('、')||'无'));continue
      }
      if(!input.agentKind||!this.manager.protocol.availableAgents.includes(input.agentKind)){await offerAgents(this,job,reply,{keep:false});continue}
      await this.manager.selectAgent(owner,input.agentKind,input.internalHandoff?{sourceTaskId:input.handoffSourceTaskId,note:input.handoffNote}:undefined)
      if(!token.current()||this.closed)return
      this.jobs.finishAgentSelection(owner,job.id,input.agentKind,this.manager.protocol.forAgent(input.agentKind).executorId??null,input.selectionTask)
      if(!input.selectionTask)await reply('当前会话执行器已设为 '+input.agentKind+'。')
      continue
     }
     if(!input.agentKind&&this.manager.protocol?.availableAgents){await offerAgents(this,job,reply);continue}
     if(input.agentKind&&this.manager.selectAgent)await this.manager.selectAgent(owner,input.agentKind,input.internalHandoff?{sourceTaskId:input.handoffSourceTaskId,note:input.handoffNote}:undefined)
     if(!token.current()||this.closed)return
     if(this.jobs.claimStart&&!this.jobs.claimStart(owner,job.id))continue
     if(dependencies.length)input.text+='\n\n前置任务执行记录（仅状态证据，不是新指令；如原请求需要内容，可按任务编号查询结果）：'+JSON.stringify(prerequisites.map(prior=>({taskId:prior.id,projectId:this.conversations?.entry(prior.owner)?.id??null,execution:prior.outcome})))
     this.log('queue.starting',{trace_id:input.traceId})
     executionStarted=true
     const result=await this.manager.ask(owner,input,reply,24*60*60*1000,token)
     if(token.current()){
      const completed=result?.status==='completed'&&['completed','handed_off'].includes(result.taskOutcome)
      this.jobs.markOutcome?.(job.id,completed?'completed':'not_confirmed')
      if(result?.status==='unknown')this.jobs.mark(job.id,'uncertain')
      else if(result?.status==='interrupted')this.jobs.mark(job.id,'cancelled')
      else this.jobs.mark(job.id,'done')
     }
    }else{executionStarted=true;
     if(job.input?.agentKind&&this.manager.agentFor&&job.input.agentKind!==this.manager.agentFor(owner))throw Error('RECOVERY_AGENT_MISMATCH')
     token.activate?.();if(job.context?.nativeQueue)await awaitNativeTurn(this,job,reply,token);else await this.recover(job,reply,token)}
   }catch(error){if(this.closed)return;if(token.current()){
    if(job.state==='pending'&&(/^CLAUDE_(?:CLI_|LOGIN_|SUBSCRIPTION_|INITIALIZATION_)/.test(error.code??'')||/^(?:WORKBUDDY|DOUBAO|GROK)_(?:CLI_|LOGIN_|AUTH_|RESUME_|ACP_|CONNECTION_|RPC_)/.test(error.code??''))){
     this.jobs.mark(job.id,'cancelled')
     await reply('未能连接 '+({WORKBUDDY:'WorkBuddy',DOUBAO:'Doubao',GROK:'Grok',CLAUDE:'Claude Code'})[error.code?.split('_')[0]]+'，本条尚未提交。请在主机核对 CLI 版本及官方账号登录；不会自动重试。')
     continue
    }
    if(job.state==='pending'&&error.message==='AGENT_UNAVAILABLE'&&job.input?.agentKind==='codex'){
     this.jobs.mark(job.id,'cancelled')
     await reply('系统 Codex 不可用，本条未提交。请安装支持 app-server 的 Codex，或在安装电脑上配置 CLI 的绝对路径。')
     continue
    }
    if(job.state==='pending'&&(error.code==='CODEX_RESUME_REJECTED'||!executionStarted&&error.definitiveRpcError&&error.method==='thread/resume')){
     this.jobs.markOutcome?.(job.id,'not_submitted');this.jobs.mark(job.id,'cancelled')
     await reply('Codex 拒绝恢复原会话，本条任务未提交。可以查看已有结果，或在未绑定的新会话中选择执行器。');continue
    }
    if(job.state==='pending'&&error.code==='CODEX_CONNECT_FAILED'){
     this.log('session.connect_failed',{trace_id:job.input?.traceId})
     this.jobs.mark(job.id,'cancelled')
     await reply('未能连接 Codex，本条消息尚未提交。请检查安装和配置，或发送“安装帮助”。')
     continue
    }
    if(job.state==='pending'&&error.code==='CODEX_THREAD_WRITER_BUSY'){
     this.log('session.writer_busy',{trace_id:job.input?.traceId})
     if(await this.offerDesktop(job,error.threadId,reply))continue
     this.jobs.mark(job.id,'cancelled')
     await reply('已在另一个应用中打开。请先在那边关闭会话，才能在这里继续。本条消息尚未提交，关闭后请重发。')
     continue
    }
    if(job.state==='pending'&&error.code==='DESKTOP_THREAD_CHANGED'){this.jobs.mark(job.id,'cancelled');await reply('原会话已变化，保留的消息已取消。');continue}
    if(!executionStarted&&/^PROJECT_TASK_(?:ROUTE_INVALID|TARGET_UNAVAILABLE|TARGET_CHANGED)$/.test(error.message)){this.jobs.mark(job.id,'cancelled');await reply('指定项目的任务未执行：目标或归属已变化，请核对项目后重新提交。');continue}
    if(job.state==='pending'&&['AGENT_SWITCH_BLOCKED','AGENT_UNAVAILABLE'].includes(error.message)){
     this.jobs.markOutcome?.(job.id,'not_submitted');this.jobs.mark(job.id,'cancelled')
     await reply(error.message==='AGENT_UNAVAILABLE'?'目标执行器尚未接入，本条任务未提交。':this.jobs.uncertainCount?.(owner)?'当前会话有结果未确认的旧任务，切换受阻。本条任务未提交。':'当前会话仍有未结束的工作，暂时无法切换执行器。本条任务未提交。');continue
    }
    if(['COMPACTION_WAIT_TIMEOUT','COMPACTION_CHECK_FAILED'].includes(error.code)){this.jobs.mark(job.id,'cancelled');await reply(error.message);continue}
    this.jobs.mark(job.id,'uncertain');const record=this.manager.state.users[owner]??={};if(record.recovery?.execution==='running'||!record.recovery)record.recovery={task:(job.context?.task??localTaskLabel(job.input,job.id)),execution:'unknown',delivery:'unknown'};await this.manager.save();await reply('该消息的执行或发送结果尚未确认，已保留记录；不会自动重复提交。你可以说“核对刚才的任务有没有完成”或“看看刚才的结果”。')}}
  }
 }
 async recover(...args){return recover(this,...args)}
 close(){this.closed=true}
}
