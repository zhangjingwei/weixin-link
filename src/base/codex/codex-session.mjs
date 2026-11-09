import {initializeCodex} from './protocol-operations.mjs'
import {homedir as platformHome} from 'node:os'
import {emptyContinuationNotice} from '../../domain/delivery/notification-policy.mjs'
import {currentMaterials,hasAttachments} from '../../domain/messages/material-association.mjs'
import {executionState} from '../../domain/tasks/execution-state.mjs'
import {publicMemoryText,nativeMemoryConfig,enableThreadMemory} from './native-memory.mjs'
import {localTaskLabel,localCompletion} from '../../domain/tasks/task-label.mjs'
import {CancellationScopes,transition} from '../../domain/tasks/lifecycle.mjs'
import {codexInput} from './codex-input.mjs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'

import {CodexRpc} from './codex-rpc.mjs'
import {controlCommand} from './control-command.mjs'
import {codexProviderOptions,providerEventCode} from './provider-options.mjs'
export {CodexRpc} from './codex-rpc.mjs'
export {controlCommand} from './control-command.mjs'
export {codexProviderOptions} from './provider-options.mjs'

export class SessionManager {
  constructor({ stateDir, cwd, owners, backend = null, agentKind = 'codex', rpcFactory = options => new CodexRpc(options), remoteControl, sessionPorts, completionMarkers = false, providerEnv = process.env, scheduleGuidance = '', log = () => {} }) {
    if (typeof remoteControl !== 'function' || typeof sessionPorts?.assistantInstructions !== 'string' ||
      ['integrationGuidance','materialInput','flowInput','stripTaskFlow','recoveryText','outputStore','outputLinks','errorFields','deliveryError','deliveryFailureState','systemNotice'].some(name=>typeof sessionPorts[name]!=='function')) throw Error('SESSION_PORTS_REQUIRED')
    this.ports=sessionPorts
    this.log = log
    this.agentKind=agentKind
    this.agentName=agentKind==='claude'?'Claude':'Codex'
    this.backend=backend
    this.instructions=this.ports.assistantInstructions+(backend?.instructions?'\n'+backend.instructions:'')
    this.completionMarkers = completionMarkers
    this.remoteControl = remoteControl
    this.lifecycle = new CancellationScopes()
    this.stateDir = stateDir
    this.cwd = cwd
    this.submissions=null
    this.outputStore=this.ports.outputStore({stateDir,cwd:backend?.workspace??cwd,fileReader:backend?.fileReader,voiceMode:process.env.WECHAT_NATIVE_VOICE_EXPERIMENTAL==='1'?'native':'file'})
    this.owners = new Set(owners)
    this.rpcFactory = rpcFactory
    this.providerEnv = providerEnv
    this.scheduleGuidance = scheduleGuidance
    this.state = { version: 1, users: {} }
    this.sessions = new Map()
    this.questions = new Map()
    this.saving = Promise.resolve()
    this.pendingSaves=0
  }
  async init() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
    await mkdir(this.backend?.workspace??this.cwd, { recursive: true, mode: 0o700 })
    try {
      const data = JSON.parse(await readFile(join(this.stateDir, 'assistant-sessions.json'), 'utf8'))
      if (data.version !== 1 || !data.users) throw new Error('Invalid assistant session state')
      this.state = data
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return this
  }
  save() {
    const data = JSON.stringify(this.state)
    this.pendingSaves++
    this.saving = this.saving.catch(() => {}).then(async () => {
      const path = join(this.stateDir, 'assistant-sessions.json')
      await writeFile(path + '.tmp', data, { mode: 0o600 })
      await rename(path + '.tmp', path)
    }).finally(()=>{this.pendingSaves--})
    return this.saving
  }
  diagnostic(session,event,fields={}) { this.log(event,{userId:session.userId,thread_id:session.threadId,turn_id:session.turnId,trace_id:session.traceId,...fields}) }
  setRecoveryDelivery(record,session,fallback='unknown') {
    if(!record)return
    const state=session.lastDelivery?.status
    const delivery=['accepted','deferred','partial','unknown','cancelled','failed','not_required'].includes(state)?state:fallback
    record.delivery=delivery
    record.delivery_updated=new Date().toISOString()
    if(['partial','unknown','cancelled','failed'].includes(delivery)&&session.lastDelivery?.error)record.delivery_error=session.lastDelivery.error
    else delete record.delivery_error
  }
  async emit(session, text, guard = () => true) {
    const context={userId:session.userId,thread_id:session.threadId,turn_id:session.turnId,trace_id:session.traceId}
    session.delivering = (session.delivering ?? Promise.resolve()).catch(() => {}).then(async()=>{
      if(!guard()){session.lastDelivery={status:'cancelled',updated:new Date().toISOString()};this.log('delivery.suppressed',{...context,reason:'stale_progress',delivery_state:'cancelled'});return false}
      const started=Date.now();this.log('delivery.started',{...context,chars:Array.from(typeof text==='string'?text:text.text).length})
      try{
        const sent=await session.reply(text,{checkpoint:()=>this.save(),current:()=>session.workToken?.current()??true,traceId:session.traceId})
        const state=['accepted','deferred','partial','unknown','cancelled','failed'].includes(sent?.status)?sent.status:'accepted'
        session.lastDelivery={status:state,updated:new Date().toISOString(),...(sent?.error?{error:sent.error}:{})}
        if(state==='accepted')session.contextRejected=false
        this.log('delivery.completed',{...context,status:state,delivery_state:state,duration_ms:Date.now()-started})
        return state==='accepted'||state==='deferred'
      }catch(error){
        const state=this.ports.deliveryFailureState(error),detail=this.ports.deliveryError(error)
        session.lastDelivery={status:state,error:detail,updated:new Date().toISOString()}
        if(detail.api_code===-2)session.contextRejected=true
        this.log('delivery.failed',{...context,status:state,delivery_state:state,duration_ms:Date.now()-started,...detail})
        return false
      }
    })
    try { return await session.delivering } catch { /* Keep the delivery outcome in lastDelivery for persisted recovery state. */ return false }
  }
  notify(session,text,guard){return this.emit(session,this.ports.systemNotice(text),guard)}
  resolveWaiters(session, result) {
    for (const resolve of session.waiters ?? []) resolve(result)
    session.waiters?.clear()
  }
  clearQuestions(session) {
    for (const [code, question] of this.questions) if (question.session === session) {
      clearTimeout(question.timer)
      this.questions.delete(code)
    }
  }
  workspaceFor(userId){return this.state.users[userId]?.workspace??this.cwd}
  outputStoreFor(userId){return this.state.users[userId]?.workspace?this.ports.outputStore({stateDir:this.stateDir,cwd:this.workspaceFor(userId),voiceMode:this.outputStore.voiceMode}):this.outputStore}
  createCatalogRpc(){return this.rpcFactory({cwd:this.cwd,provider:'configured',providerOptions:this.providerOptions(),onEvent:()=>{},onClose:()=>{},log:this.log})}
  providerOptions() {
    return codexProviderOptions(this.providerEnv)
  }
  attachRpc(session) {
    const provider='configured',providerOptions=this.providerOptions()
    const attempt={provider,current:true,closing:false,rpc:null,providerOptions}
    session.rpcAttempt=attempt
    const rpc=this.rpcFactory({
      cwd:this.workspaceFor(session.userId),provider,providerOptions,
      log:(event,fields)=>this.diagnostic(session,event,{provider,...fields}),
      onEvent:message=>{
        if(!attempt.current||attempt.closing||session.rpcAttempt!==attempt)return
        session.events=(session.events??Promise.resolve()).catch(()=>{}).then(()=>{
          if(!attempt.current||session.rpcAttempt!==attempt)return
          return this.event(session,message)
        })
        return session.events
      },
      onClose:()=>{
        if(!attempt.current||attempt.closing||session.rpcAttempt!==attempt)return
        attempt.closing=true
        // A completion notification may already be queued behind earlier deliveries.
        // Drain received events before deciding whether the turn is still unknown.
        session.events=(session.events??Promise.resolve()).catch(()=>{}).then(async()=>{
          if(!attempt.current||session.rpcAttempt!==attempt)return
          attempt.current=false
          this.clearQuestions(session)
          const queued=session.queue.length
          session.queue=[]
          const current=this.sessions.get(session.userId)
          if(current&&current!==session){
            this.resolveWaiters(session,{status:'unknown',reply:`${this.agentName} 连接中断，任务结果尚未确认。`})
            if(queued)await this.notify(session,`连接中断，${queued} 条排队消息尚未提交，请重新发送。`)
            return
          }
          if(session.busy||session.exiting){
            this.resolveWaiters(session, { status: 'unknown', reply: `${this.agentName} 连接中断，任务结果尚未确认。` })
            if (session.exiting) await this.finishExit(session, '未收到任务停止确认，连接已断开。')
            else {
              const record=this.state.users[session.userId]
              if(record?.recovery?.execution==='running'){record.recovery.execution='unknown';await this.save().catch(()=>{})}
              transition(session,'idle')
              await this.notify(session, `${this.agentName} 连接中断，任务结果尚未确认。再次发消息可恢复对话。`)
            }
          }
          if(queued&&!session.exiting)await this.notify(session,`连接中断，${queued} 条排队消息尚未提交，请重新发送。`)
        }).catch(error=>this.diagnostic(session,'rpc.close_failed',this.ports.errorFields(error)))
      },
    })
    attempt.rpc=rpc
    session.rpc=rpc
    return attempt
  }
  detachRpc(session, attempt) {
    if(!attempt)return
    attempt.current=false
    if(session.rpcAttempt===attempt)session.rpcAttempt=null
    try{attempt.rpc?.close()}catch{}
  }
  async sessionInstructions(userId) {
    // Local integrations execute in this account's host environment, not a remote/container backend.
    const guidance=this.backend && this.backend.kind !== 'host' ? '' : await this.ports.integrationGuidance({stateDir:this.stateDir})
    let workspaceRules=''
    if(this.agentKind==='claude')try{const content=await readFile(join(this.workspaceFor(userId),'AGENTS.md'),'utf8');if(Buffer.byteLength(content)>64*1024)throw Error('WORKSPACE_RULES_TOO_LARGE');workspaceRules='\n\n工作区规则（AGENTS.md）：\n'+content}catch(error){if(error.code!=='ENOENT')throw error}
    return this.instructions+(this.backend?.kind === 'host' && this.agentKind === 'codex' && this.scheduleGuidance ? '\n\n'+this.scheduleGuidance : '')+(guidance?'\n\n'+guidance:'')+workspaceRules
  }
  async startProvider(session) {
    const provider='configured',attempt=this.attachRpc(session)
    const saved=this.state.users[session.userId]??={}
    try {
      await initializeCodex(attempt.rpc,{name:'wechat_codex',title:'WeChat',version:'3.0.0'})
      if(session.exited||attempt.rpc.closed)throw Error('会话已取消连接。')
      const params={config:nativeMemoryConfig,cwd:this.workspaceFor(session.userId),sandbox:'danger-full-access',approvalPolicy:'never',developerInstructions:await this.sessionInstructions(session.userId),...attempt.providerOptions.thread}
      let result
      if(saved.threadId){
        try{result=await attempt.rpc.request('thread/resume',{...params,threadId:saved.threadId,excludeTurns:true})}
        catch(error){
          if(saved.hasMessages||!error.message.includes('no rollout found for thread id'))throw error
        }
      }
      result??=await attempt.rpc.request('thread/start',params)
      if(session.exited||attempt.rpc.closed)throw Error('会话已取消连接。')
      if(this.agentKind==='codex'&&(result.sandbox?.type!=='dangerFullAccess'||result.approvalPolicy!=='never'))throw Error('Codex 未应用配置的会话权限。')
      if(this.agentKind==='codex')await enableThreadMemory(attempt.rpc,result.thread.id)
      if(session.exited||attempt.rpc.closed)throw Error('会话已取消连接。')
      session.provider=provider
      session.model=result.model
      session.modelProvider=result.modelProvider??attempt.providerOptions.provider??null
      session.threadId=saved.threadId=result.thread.id
      this.diagnostic(session,'provider.connected',{provider,model:session.model,model_provider:session.modelProvider})
      return session
    } catch(error) {
      this.detachRpc(session,attempt)
      throw error
    }
  }
  async connect(userId, reply) {
    if (!this.owners.has(userId)) throw new Error('当前微信账号未获授权。')
    if(!this.sessions.get(userId)||this.sessions.get(userId).rpc?.closed)await this.beforeConversationConnect?.(userId)
    const existing = this.sessions.get(userId)
    if (existing && !existing.rpc?.closed) { await existing.connectionReady; existing.reply = reply; return existing }
    const saved = this.state.users[userId] ??= {}
    const session = { userId, reply, busy: false, connecting: true, queue: [], finals: [], items: new Map() }
    transition(session,'connecting')
    let resolveReady,rejectReady
    session.connectionReady=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
    void session.connectionReady.catch(()=>{})
    this.sessions.set(userId, session)
    try {
      await this.startProvider(session)
      await this.save()
      transition(session,'idle');resolveReady(session)
      this.diagnostic(session,'session.connected',{provider:session.provider,model:session.model,model_provider:session.modelProvider})
      return session
    } catch (error) {
      transition(session,'closed');rejectReady(error);this.detachRpc(session,session.rpcAttempt)
      if(this.sessions.get(userId)===session)this.sessions.delete(userId)
      throw error
    }
  }

  conversationIds(userId) {
    const saved=this.state.users[userId]??{}
    return [...new Set([saved.threadId,...(saved.previous??[]).slice().reverse()].filter(id=>typeof id==='string'&&id))]
  }
  async listConversations(userId,reply) {
    const ids=this.conversationIds(userId)
    if(!ids.length){await reply('暂无本账号下属于你的历史对话。');return}
    const session=await this.connect(userId,reply),lines=[]
    for(const [index,id] of ids.entries()){
      let title='历史对话'
      try{const r=await session.rpc.request('thread/read',{threadId:id,includeTurns:false});if(r.thread?.id===id&&r.thread.name)title=String(r.thread.name).replace(/[\r\n]/g,' ').slice(0,60)}catch{title='暂不可读取，恢复时会核验'}
      lines.push(`${index+1}. ${id===session.threadId?'[当前] ':''}${title}（${id}）`)
    }
    this.state.users[userId].conversationChoices=ids;await this.save()
    await reply('本账号下你的对话（树莓派·微信主助手）：\n'+lines.join('\n')+'\n发送“切换 编号” 继续；也可指定列表中的完整会话ID。')
  }
  async resumeConversation(userId,selection,reply,token) {
    if(!selection){await this.listConversations(userId,reply);return}
    const saved=this.state.users[userId]??{},ids=this.conversationIds(userId)
    const id=/^[0-9]+$/.test(selection)?saved.conversationChoices?.[Number(selection)-1]:selection
    if(!id||!ids.includes(id))throw Error('只能选择本账号下属于你的对话，请先用“列表” 查看。')
    const busy=()=>{const r=this.sessions.get(userId);return r&&(r.busy||r.finishing||r.connecting||r.selecting||r.exiting||r.queue?.length||r.state==='stopping')}
    if(busy()||(this.submissions?.pending?.()??[]).some(j=>j.owner===userId)||this.submissions?.uncertainCount?.(userId))throw Error('仍有执行、排队或未确认任务，请先处理完再切换对话。')
    const session=await this.connect(userId,reply)
    if(!token.current())return
    if(busy())throw Error('会话正在处理其他操作，请稍后再切换。')
    if(id===session.threadId){await reply('当前已在该对话中，直接发消息即可。');return}
    session.selecting=true
    try{
      const scope=createHash('sha256').update(session.threadId).digest('hex').slice(0,24)
      let remote={};try{remote=JSON.parse(await readFile(join(this.cwd,'remote-sessions.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
      if(Object.values(remote).some(t=>t?.kind==='official-remote-task'&&t.scope===scope&&!t.stop_confirmed))throw Error('当前对话仍有未确认停止的远程任务，请先用 “停止” 核实，再切换。')
      const meta=(await session.rpc.request('thread/read',{threadId:id,includeTurns:false})).thread
      if(meta?.id!==id||meta.cwd&&meta.cwd!==this.workspaceFor(userId))throw Error('历史对话目录不匹配，未切换。')
      if(meta.status?.type==='active')throw Error('目标对话正在执行任务，未切换。')
      const selectedProvider=this.providerOptions()
      const result=await session.rpc.request('thread/resume',{config:nativeMemoryConfig,cwd:this.workspaceFor(session.userId),sandbox:'danger-full-access',approvalPolicy:'never',developerInstructions:await this.sessionInstructions(session.userId),threadId:id,excludeTurns:true,...selectedProvider.thread})
      if(result.thread?.id!==id||this.agentKind==='codex'&&(result.sandbox?.type!=='dangerFullAccess'||result.approvalPolicy!=='never'))throw Error(`${this.agentName} 未确认目标对话，未切换。`)
      await enableThreadMemory(session.rpc,id)
      if(!token.current())return
      const previous=this.state.users[userId],oldId=session.threadId
      const next={seen:previous.seen,workspace:previous.workspace,previous:ids.filter(v=>v!==id).reverse().slice(-20),threadId:id,hasMessages:true,conversationChoices:previous.conversationChoices}
      this.state.users[userId]=next;session.threadId=id
      try{await this.save()}catch(e){if(this.state.users[userId]===next){this.state.users[userId]=previous;session.threadId=oldId}throw e}
      this.lifecycle.cancel(userId)
      this.clearQuestions(session);session.items.clear();session.finals=[];session.localTask=null;session.lastProgress=null;session.turnId=null;session.attachmentContinuation=null;session.model=result.model;session.modelProvider=result.modelProvider??selectedProvider.provider??session.modelProvider
      this.diagnostic(session,'session.selected',{previous_thread_id:oldId})
      await reply('已恢复对话 '+id+'，下一条消息将在该对话中继续。')
    }finally{session.selecting=false}
  }
  async send(session, text, token = this.lifecycle.capture(session.userId)) {
    if(!token.current())return
    if (session.exited || session.rpc.closed) return
    if(session.selecting)throw new Error('正在切换对话，请稍后再发送。')
    if (session.exiting) throw new Error('正在停止并退出，请等待结束。')
    if (session.busy || session.finishing) {
      if (session.queue.length >= 5) throw new Error('已排队 5 条消息，请等待当前任务完成。')
      session.queue.push({input:text,token})
      this.diagnostic(session,'turn.queued',{queue_depth:session.queue.length})
      await this.notify(session, `消息已排队（第 ${session.queue.length} 条）。`)
      return
    }
    transition(session,'running')
    session.lastProgress=null
    session.contextRejected=false
    session.workToken=token
    session.traceId = typeof text==='object'&&/^[a-zA-Z0-9_-]{8,64}$/.test(text.traceId??'')?text.traceId:randomBytes(8).toString('hex')
    const waiting=this.state.users[session.userId]?.waitingAttachment
    session.attachmentContinuation=hasAttachments(text)&&waiting?waiting:null
    session.localTask=session.attachmentContinuation?.task??localTaskLabel(text,typeof text==='object'&&text.deliveryId?text.deliveryId:session.traceId)

    session.waitingAttachment=false
    session.requestText=typeof text==='string'?text:text.text

    this.state.users[session.userId]??={}
    this.state.users[session.userId].recovery={task:session.localTask,execution:'running',delivery:null,updated:new Date().toISOString()}
    session.startedAt = Date.now()
    this.diagnostic(session,'turn.requested')
    session.turnReady = false
    session.turnStarted = false
    session.finalReceived = false
    session.finals = []
    session.generatedOutputs=[]
    session.displayFinals=[]
    session.imageOutputIds=new Set()
    session.items.clear()
    const traceId=session.traceId
    let result
    try {
      await this.remoteControl(this.cwd,session.threadId,'activate')
      if(!token.current()){if(!session.exited&&session.traceId===traceId){transition(session,'idle');session.turnReady=true;this.resolveWaiters(session,{status:'interrupted',reply:'任务已取消。'})}return}
      const deliveryId=typeof text==='object'?text.deliveryId:undefined
      if(deliveryId){this.submissions?.context?.(deliveryId,{task:session.localTask,request:session.requestText,continuation:session.attachmentContinuation,flowNonce:session.traceId,materials:currentMaterials(text,deliveryId)});this.submissions?.bind(deliveryId,session.threadId)}
      const materials=currentMaterials(text,deliveryId??session.traceId),pendingMaterials=this.submissions?.pendingMaterials?.(session.userId,deliveryId)??0
      session.materials=materials
      this.diagnostic(session,'materials.context',{count:materials.length,queue_depth:pendingMaterials,reason:session.attachmentContinuation?'continuation':materials.length?'current':'unbound'})
      const runtimeInput=this.backend?.prepareInput?await this.backend.prepareInput(text,{signal:token.signal}):text
      const turnParams={threadId:session.threadId,input:[...codexInput(runtimeInput),this.ports.flowInput(session.traceId),this.ports.materialInput({materials,pending:pendingMaterials,continuation:!!session.attachmentContinuation}),...(session.attachmentContinuation?[{type:'text',text:'当前附件用于继续此前等待中的用户请求（保持原授权范围）：'+JSON.stringify(session.attachmentContinuation.request)}]:[])],...(deliveryId?{clientUserMessageId:deliveryId}:{})}
      result=await session.rpc.request('turn/start',turnParams)
      if(deliveryId)this.submissions?.submitted(deliveryId,result.turn.id)
      if(waiting&&this.state.users[session.userId]?.waitingAttachment===waiting)delete this.state.users[session.userId].waitingAttachment
    } catch(error) {
      if(session.exited || session.traceId!==traceId)return
      transition(session,'closed');session.queue=[];this.detachRpc(session,session.rpcAttempt)
      throw error
    }
    // Notifications may finish this turn and start the next before the RPC continuation runs.
    if(session.exited || !session.busy || session.traceId!==traceId)return
    session.turnId=result.turn.id
    session.turnReady=true
    this.state.users[session.userId].hasMessages=true
    try{await this.save()}catch(error){
      this.diagnostic(session,'state.save_failed',this.ports.errorFields(error))
      await this.notify(session,'任务已启动，但微信会话状态保存失败；任务继续执行。')
    }
  }
  interrupt(session) {
    const traceId=session.traceId
    if(session.interrupting?.traceId===traceId)return session.interrupting.promise
    const promise=this.interruptTurn(session,traceId)
    session.interrupting={traceId,promise}
    void promise.catch(()=>{if(session.interrupting?.promise===promise)session.interrupting=undefined})
    return promise
  }
  async interruptTurn(session,traceId) {
    if(session.busy)transition(session,'stopping')
    this.diagnostic(session,'turn.interrupt_requested',{queue_depth:session.queue.length})
    session.queue = []
    for (let attempt = 0; attempt < 100 && session.traceId===traceId && session.busy && !session.turnReady && !session.rpc.closed; attempt++) await new Promise(resolve => setTimeout(resolve, 100))
    if(session.traceId!==traceId)return
    if (session.busy && !session.turnReady) throw new Error('等待任务启动确认超时。')
    for (let attempt = 0; attempt < 20 && session.traceId===traceId && session.busy && !session.rpc.closed; attempt++) {
      try { const result=await session.rpc.request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId });if(this.backend?.stopBackground)await this.backend.stopBackground(session);return result }
      catch (error) {
        if (!error.message.includes('no active turn to interrupt') || attempt === 19) throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }
  async finishExit(session, detail = '') {
    if (session.exited) return
    transition(session,'closed')
    session.queue = []
    clearTimeout(session.exitTimer)
    this.clearQuestions(session)
    this.resolveWaiters(session, { status: 'interrupted', reply: detail || '会话已退出。' })
    if(this.sessions.get(session.userId)===session)this.sessions.delete(session.userId)
    session.rpc.close()
    await this.notify(session, `${detail ? detail + '\n' : ''}已结束当前会话连接。聊天记录已保留，继续发消息即可恢复。`)
  }
  deny(method) {
    if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
    if (method === 'item/tool/requestUserInput') return { answers: {} }
    return { decision: 'decline' }
  }
  async event(session, message) {
    const p = message.params ?? {}
    if(message.method==='thread/name/updated'){await this.onConversationTitle?.(p.threadId,p.threadName??p.name);return}
    if(message.method==='thread/archived'||message.method==='thread/unarchived'){await this.onConversationArchive?.(p.threadId,message.method==='thread/archived');return}
    if(message.method==='thread/deleted'){await this.onConversationDelete?.(p.threadId);return}
    if(p.threadId&&p.threadId!==session.threadId){this.diagnostic(session,'event.ignored',{reason:'wrong_thread',method:message.method});return}
    if (message.id !== undefined && message.method) {
      // A cancelled/completed turn must not create fresh approval prompts.
      if (!session.busy || session.exited || (session.workToken && !session.workToken.current()) || (p.turnId && p.turnId !== session.turnId)) {
        session.rpc.respond(message.id, this.deny(message.method))
        this.diagnostic(session,'event.ignored',{reason:'inactive_interaction',method:message.method})
        return
      }
      const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput']
      if (!supported.includes(message.method)) {
        session.rpc.write({ id: message.id, error: { code: -32601, message: 'Unsupported client interaction' } })
        await this.notify(session, `Codex 请求了暂不支持的交互：${message.method}，该请求未获执行。`)
        return
      }
      const item = session.items.get(p.itemId)
      if ((message.method === 'item/tool/requestUserInput' && p.questions?.some(q => q.isSecret)) ||
          (message.method === 'item/fileChange/requestApproval' && !item?.changes?.length)) {
        session.rpc.respond(message.id, this.deny(message.method))
        await this.notify(session, '该请求需要秘密信息或缺少可审查的变更内容，请在主机终端处理。不要在微信发送密码或令牌。')
        return
      }
      const code = randomBytes(3).toString('hex')
      const question = { session, message }
      question.timer = setTimeout(() => {
        this.questions.delete(code)
        try { session.rpc.respond(message.id, this.deny(message.method)) } catch {}
        this.notify(session, `请求 ${code} 已过期，未予批准。`)
      }, 10 * 60_000)
      this.questions.set(code, question)
      this.diagnostic(session,'interaction.requested',{method:message.method})
      let text
      if (message.method === 'item/tool/requestUserInput') {
        text = p.questions.map((q, i) => `${i + 1}. ${q.question}${q.options?.length ? '\n' + q.options.map(o => `${o.label}：${o.description}`).join('\n') : ''}`).join('\n\n')
        text += `\n\n/回答 ${code} 你的答案\n多个问题的答案用 | 分隔。`
      } else {
        text = `${p.reason ?? 'Codex 请求批准操作'}\n目录：${p.cwd ?? this.cwd}\n${p.command ?? JSON.stringify(item?.changes ?? p.permissions ?? p.networkApprovalContext)}\n\n/批准 ${code}\n/拒绝 ${code}`
      }
      await this.notify(session, text)
      return
    }
    if(message.method==='error'){
      const code=providerEventCode(p)
      if(code)this.diagnostic(session,'provider.event_error',{provider:session.provider,stage:session.turnStarted?'turn':'turn_start',reason:code,rpc_code:code})
      return
    }
    if (message.method === 'turn/started' && session.busy) { session.turnReady = true; session.turnStarted = true; session.turnId = p.turn.id; this.diagnostic(session,'turn.started',{provider:session.provider,model:session.model,model_provider:session.modelProvider}) }
    // Ignore delayed item notifications from a completed or superseded turn.
    if (['item/started', 'item/completed','item/agentMessage/delta'].includes(message.method)) {
      if (!session.busy || !session.turnReady || (session.finalReceived&&p.item?.type!=='imageGeneration')) { this.diagnostic(session,'event.ignored',{reason:'inactive_or_final',method:message.method}); return }
      if (p.turnId && p.turnId !== session.turnId) { this.diagnostic(session,'event.ignored',{reason:'old_turn',method:message.method}); return }
    }
    // A completed commentary item is one user-facing stage. Streaming deltas
    // are intentionally silent so a multi-sentence update is sent once.
    if(message.method==='item/agentMessage/delta')return
    if (message.method === 'item/started') {
      // Retain metadata for approval review, but do not invent generic progress messages.
      session.items.set(p.item.id, p.item)
      this.diagnostic(session,'tool.started',{kind:p.item.type})
      if(!['agentMessage','userMessage','reasoning','plan'].includes(p.item.type))await this.onToolStatus?.(session,p.item,true)
    }
    if (message.method === 'item/completed') {
      if(p.item?.type&&!['agentMessage','userMessage','reasoning','plan'].includes(p.item.type))await this.onToolStatus?.(session,p.item,false)
      if(p.item?.type==='imageGeneration'&&!p.item.failure&&['completed','succeeded','success'].includes(p.item.status)&&(session.workToken?.current()??true)){
        session.imageOutputIds??=new Set()
        if(!session.imageOutputIds.has(p.item.id)){
          session.imageOutputIds.add(p.item.id);session.generatedOutputs??=[]
          if(typeof p.item.savedPath==='string')session.generatedOutputs.push({path:p.item.savedPath,image:true})
          else if(typeof p.item.result==='string')session.generatedOutputs.push({data:p.item.result,image:true})
        }
      }
      if (p.item?.type === 'webSearch') this.diagnostic(session,'tool.completed',{kind:'webSearch'})
      if(p.item?.type&&p.item.type!=='agentMessage'&&p.item.type!=='webSearch')this.diagnostic(session,'tool.completed',{kind:p.item.type,status:p.item.status,exit_code:p.item.exitCode})
      if (p.item?.type === 'agentMessage' && p.item.text) {
        const flow=this.ports.stripTaskFlow(publicMemoryText(p.item.text),session.traceId)
        const rest=flow.text
        if(p.item.phase==='final_answer'||!p.item.phase)session.waitingAttachment=flow.waiting
        if (p.item.phase === 'commentary') {
          const turnId = session.turnId
          if(session.contextRejected){this.diagnostic(session,'notification.suppressed',{reason:'context_rejected'});return}
          if(session.attachmentContinuation&&emptyContinuationNotice(rest)){this.diagnostic(session,'notification.suppressed',{reason:'continuation_start'});return}
          if(rest){
            const delivered=await this.emit(session, rest, () => (session.workToken?.current()??true) && session.busy && !session.finalReceived && session.turnId === turnId)
            if(delivered&&session.turnId===turnId)session.lastProgress={text:rest,at:Date.now(),turnId}
          }
        } else { if(p.item.phase!=='partial_answer')session.finalReceived = true; session.finals.push(rest);session.displayFinals??=[];session.displayFinals.push(rest) }
      }
    }
    if (message.method === 'turn/completed' && session.busy) {
      if (p.turn?.id && p.turn.id !== session.turnId) return
      if(this.sessions.has(session.userId)&&this.sessions.get(session.userId)!==session)return
      transition(session,'delivering')
      this.clearQuestions(session)
      const awaitingAttachment=p.turn.status==='completed'&&session.waitingAttachment&&(session.workToken?.current()??true)
      this.diagnostic(session,'materials.resolution',{status:awaitingAttachment?'waiting_attachment':p.turn.status,count:session.materials?.length??0})
      if(awaitingAttachment)this.state.users[session.userId].waitingAttachment={task:session.localTask,request:session.requestText,threadId:session.threadId}
      const receivedWhileWaiting=awaitingAttachment&&(this.submissions?.pendingMaterials?.(session.userId,undefined)??0)>0
      let reply = session.finals.join('\n\n')
      if(receivedWhileWaiting){reply='请求已保留，正在核对已收到的附件。';this.diagnostic(session,'materials.waiting_notice_adjusted',{reason:'received_pending'})}
      if (p.turn.status === 'failed') reply += `\n${this.agentName} 任务失败：${p.turn.error?.message ?? '未返回错误详情。'}`
      else if (p.turn.status === 'interrupted') reply += '\n当前任务已停止。'
      else if (!reply) reply = '本轮任务已结束，但未返回文字回复。'
      // The footer describes execution completion, not delivery acceptance.
      const mergedCompletion=this.completionMarkers&&!awaitingAttachment&&(session.workToken?.current()??true)
      if(mergedCompletion){
        const marker=p.turn.status==='failed'?'⚠️ 本轮执行失败，回答已结束。':p.turn.status==='interrupted'?'⏹ 本轮已停止。':'✅ 本轮回答结束。'
        reply+='\n\n'+localCompletion(marker,session.localTask)
      }
      let output=reply
      if((session.workToken?.current()??true)&&(session.generatedOutputs?.length||this.ports.outputLinks(reply).length)){
        try{output=await this.outputStoreFor(session.userId).package(session.userId,reply,session.generatedOutputs??[],session.workToken?.signal)}catch(error){
          if(session.workToken&&!session.workToken.current())reply+='\n附件发送已取消。'
          else{this.diagnostic(session,'outbound.prepare_failed',this.ports.errorFields(error));reply+='\n附件准备失败，可稍后重试。'}
          output=reply
        }
      }
      session.generatedOutputs=[]
      if(this.sessions.has(session.userId)&&this.sessions.get(session.userId)!==session)return
      this.state.users[session.userId].lastOutput=typeof output==='string'?undefined:output
      this.state.users[session.userId].recovery={task:session.localTask,execution:executionState(p.turn.status,awaitingAttachment),delivery:'pending',updated:new Date().toISOString()}
      this.state.users[session.userId].lastTask=session.localTask
      this.state.users[session.userId].lastReply = reply
      try { await this.save() } catch(error) { this.diagnostic(session,'state.save_failed',this.ports.errorFields(error));reply+='\n（微信会话状态保存失败，本轮回复可能无法在重启后恢复。）';this.state.users[session.userId].lastReply=reply }
      this.diagnostic(session,'turn.completed',{status:p.turn.status,provider:session.provider,model:session.model,model_provider:session.modelProvider,duration_ms:Date.now()-(session.startedAt??Date.now()),chars:Array.from(reply).length})
      if (session.exited) return
      if (session.exiting) { await this.finishExit(session, p.turn.status === 'interrupted' ? '当前任务已停止。' : '本轮任务已结束。'); return }
      const display=receivedWhileWaiting?reply:(session.displayFinals??session.finals).join('\n\n')+reply.slice(session.finals.join('\n\n').length)
      if(receivedWhileWaiting){this.diagnostic(session,'notification.suppressed',{reason:'attachment_already_pending'})}
      else if(typeof output==='string'){if(display)await this.emit(session,display)}else await this.emit(session,{...output,text:display+output.text.slice(reply.length)})
      const recovery=this.state.users[session.userId].recovery
      if(receivedWhileWaiting){session.lastDelivery={status:'not_required',updated:new Date().toISOString()}}
      const currentRecovery=this.sessions.get(session.userId)===session||!this.sessions.has(session.userId)
      if(currentRecovery&&this.state.users[session.userId].recovery===recovery){
        this.setRecoveryDelivery(recovery,session)
        this.diagnostic(session,'delivery.state_changed',{delivery_state:recovery.delivery,status:p.turn.status})
        try{await this.save()}catch(error){this.diagnostic(session,'recovery.save_failed',this.ports.errorFields(error))}
      }
      // An exceptional transport failure cannot be predicted in an already-sent footer.
      // Keep a separate warning only for failure, never a second normal completion.
      if(mergedCompletion&&currentRecovery&&!['accepted','deferred','not_required'].includes(recovery.delivery)){
        const warning=recovery.delivery==='failed'?'⚠️ 最终结果发送失败，结果已保存，可发 结果 重发。':'⚠️ 部分内容未确认送达，结果已保存，可发 结果 查看。'
        await this.notify(session,localCompletion(warning,session.localTask),()=>!session.exited&&(session.workToken?.current()??true))
      }
      this.resolveWaiters(session, { status: p.turn.status, reply })
      if(session.exited)return
      transition(session,'idle')
      if (session.queue.length&&!session.rpcAttempt?.closing&&!session.rpc?.closed) {
        try { await (()=>{const next=session.queue.shift();return typeof next==='string'?this.send(session,next):this.send(session,next.input,next.token)})() }
        catch (error) { await this.notify(session, `排队消息未能执行：${error.message}`) }
      }
    }
  }
  async acceptMessage(userId,messageId) {
    if (!this.owners.has(userId)) return false
    if (messageId === undefined || messageId === '') return true
    const record=this.state.users[userId]??={},id=String(messageId)
    if(record.seen?.includes(id)){this.log('message.duplicate',{userId,messageId:id});return false}
    const previous=record.seen,accepted=[...(previous??[]),id].slice(-100)
    record.seen=accepted
    try{await this.save()}catch(error){if(record.seen===accepted)record.seen=previous;throw error}
    return true
  }
  async steer(userId, text, reply, token) {
    if(!text){await reply('用法：补充 内容，例如“补充 先别部署，先给我看效果”。');return}
    const session=this.sessions.get(userId)
    if(!token.current()||!session||session.state!=='running'||session.exited||session.rpc.closed||session.finalReceived||!(session.workToken?.current()??false)){
      await reply('当前没有可接收补充的执行中任务；本条未提交，也未排队。');return
    }
    if(!session.turnReady||!session.turnStarted||!session.turnId){await reply('当前任务仍在启动，补充尚未提交；请等任务开始后再补充。');return}
    const {threadId,turnId,traceId,rpc}=session
    const record=this.state.users[userId]
    const entry={id:randomBytes(12).toString('hex'),threadId,turnId,text,status:'unknown',created:new Date().toISOString()}
    record.supplements=[...(record.supplements??[]).slice(-49),entry]
    // Persist the uncertain write before sending. Never replay turn/steer after a crash.
    await this.save()
    if(!token.current()||!session.workToken.current()||session.state!=='running'||session.traceId!==traceId||session.turnId!==turnId||session.finalReceived||session.rpc!==rpc||rpc.closed){
      entry.status='not_sent';await this.save();await reply('原任务已结束或停止，补充未提交，也未转入其他任务。');return
    }
    let notice
    try{
      const result=await rpc.request('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text}]})
      if(result?.turnId!==turnId)throw Error('补充回执未匹配原任务。')
      entry.status='accepted'
      notice='补充已提交给当前任务，将在后续处理时参考。'
      this.diagnostic(session,'turn.steer_accepted',{target_turn_id:turnId})
    }catch(error){
      entry.status=error.definitiveRpcError?'rejected':'unknown'
      notice=entry.status==='rejected'?'补充未被当前任务接收，可能已结束或暂不支持；本条未排队。':'补充提交结果不确定，未自动重发或排队，避免重复执行。'
      this.diagnostic(session,'turn.steer_failed',{target_turn_id:turnId,status:entry.status,...this.ports.errorFields(error)})
    }
    try{await this.save()}catch(error){notice+=' 接入层记录保存失败。';this.diagnostic(session,'state.save_failed',this.ports.errorFields(error))}
    await reply(notice)
  }
  async handle(userId, text, reply, messageId, token = this.lifecycle.capture(userId)) {
    if (!this.owners.has(userId)) { await reply('当前微信账号未获授权。'); return }
    if (!await this.acceptMessage(userId,messageId)) return
    const command = typeof text === 'string' ? controlCommand(text) : null
    if(!command&&!token.current())return
    this.log('message.handled',{userId,messageId,kind:command?.action??(typeof text==='string'?'text':'media')})
    try {
      if(command?.action==='steer'){await this.steer(userId,command.text,reply,token);return}
      if(command?.action==='memory'){
        if(this.agentKind==='claude'){await reply('当前 Claude 底座未接入可验证的长期记忆开关或状态；未执行记忆修改。');return}
        const session=await this.connect(userId,reply);if(command.op==='auto'){await session.rpc.request('thread/memoryMode/set',{threadId:session.threadId,mode:command.on?'enabled':'disabled'});await reply('Codex已确认当前会话原生记忆模式：'+(command.on?'开启':'关闭')+'。');}else if(command.op==='list'){const status=await session.rpc.request('memory/status',{});await reply('当前使用Codex原生记忆。\n已整合会话：'+(status.v2ConsolidatedThreads??'未知')+'；就绪：'+(status.v2Ready?'是':'否')+'。\n当前不使用微信逐条记忆库；“开启记忆”或“关闭记忆” 控制当前会话原生记忆。');}else await reply('当前使用Codex原生记忆，未执行微信逐条记忆的修改或清空。可用“记忆” 查看状态。');return
      }
      if (['approval', 'answer'].includes(command?.action)) {
        const question = this.questions.get(command.code)
        if (!question || question.session.userId !== userId) throw new Error('请求已过期、不存在或不属于当前账号。')
        const { session, message } = question
        const isQuestion = message.method === 'item/tool/requestUserInput'
        if ((command.action === 'answer') !== isQuestion) throw new Error(isQuestion ? '请用 /回答 提供答案。' : '请用 /批准 或 /拒绝。')
        let result
        if (isQuestion) {
          const answers = command.text.split('|').map(s => s.trim())
          if (answers.length !== message.params.questions.length) throw new Error('请用 | 分隔每个问题的答案。')
          result = { answers: Object.fromEntries(message.params.questions.map((q, i) => [q.id, { answers: [answers[i]] }])) }
        } else result = command.accept ? message.method === 'item/permissions/requestApproval' ? { permissions: message.params.permissions, scope: 'turn' } : { decision: 'accept' } : this.deny(message.method)
        session.rpc.respond(message.id, result)
        clearTimeout(question.timer)
        this.questions.delete(command.code)
        await reply('已将答复发送给 Codex。')
        return
      }
      if(command?.action==='sessions'){await this.listConversations(userId,reply);return}
      if(command?.action==='resume'){await this.resumeConversation(userId,command.selection,reply,token);return}
      if(command?.action==='models'){
        if(this.agentKind==='claude'){await reply('Claude 底座暂未提供可核验的模型目录；未切换模型。');return}
        const session=await this.connect(userId,reply),models=[],cursors=new Set();let cursor
        for(let page=0;page<10;page++){
          const result=await session.rpc.request('model/list',{limit:50,includeHidden:false,...(cursor?{cursor}:{})})
          if(!Array.isArray(result.data))throw Error('Codex 未返回有效的模型列表。')
          models.push(...result.data);cursor=result.nextCursor
          if(!cursor)break
          if(cursors.has(cursor))throw Error('Codex 模型列表分页异常，请稍后重试。')
          cursors.add(cursor)
        }
        if(cursor)throw Error('模型列表超过查询上限，请在主机查看。')
        const entries=[...new Map(models.filter(m=>typeof m.model==='string'&&!m.hidden).map(m=>[m.model,m])).values()]
        const lines=entries.map(m=>`${m.model}${session.model===m.model?' [当前]':''}${m.isDefault?' [默认]':''}\n输入：${Array.isArray(m.inputModalities)?m.inputModalities.join('、'):'未提供'}；推理档位：${(m.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort).join('、')||'未提供'}`)
        await reply('Codex 返回的模型列表（只查询，不切换）：\n'+(lines.join('\n\n')||'当前未返回可显示的模型。'));return
      }
      if (command?.action === 'help') {await reply('直接发送需求即可。发送“使用说明”查看完整说明，“安装向导”完成首次设置。\n常用：日常助手、状态、停止、结果、恢复、退出、模型、记忆、开启记忆、关闭记忆、列表、新建 名称、切换智能体。\n配置远程主机、家庭设备或备份：直接说明需求，由智能体通过配置命令检查和处理；需要模型可用。\n归档保留历史；删除是不可还原的永久删除。');return}
      const runtime = this.sessions.get(userId)
      if(command?.action==='progress'){
        const queued=(runtime?.queue.length??0)+(this.submissions?.pending().filter(j=>j.owner===userId&&j.state==='pending').length??0)
        const state=runtime?.state??(runtime?.connecting?'connecting':runtime?.busy?'running':runtime?.finishing?'delivering':'idle')
        const label=({connecting:'正在连接智能体',running:'正在处理',stopping:'正在停止',delivering:'正在发送最终回复',closed:'连接已断开',idle:'当前没有正在执行的任务'})[state]??'当前没有正在执行的任务'
        const latest=['running','delivering'].includes(state)&&runtime?.lastProgress?.turnId===runtime.turnId?`\n最近进展：${runtime.lastProgress.text}`:''
        await reply(`${label}${queued?`；排队 ${queued} 条`:''}。${latest||(['running','connecting'].includes(state)?'\n尚无新的阶段信息。':'')}`)
        return
      }
      if (command?.action === 'status') { try{const root=join((process.env.HOME||platformHome()),'.local/share/wechat-assistant-backups');let b;try{b=JSON.parse(await readFile(join(root,'last-failure.json'),'utf8'));await reply('备份：最近一次失败或因忙碌延后，请检查备份服务。')}catch{b=JSON.parse(await readFile(join(root,'latest.json'),'utf8'));await reply(b.status==='verified'?'备份：'+b.generation+'，NAS校验及隔离恢复通过。':'备份：最近一次未验证成功。')}}catch{} const recovery=this.ports.recoveryText(this.state.users[userId]?.recovery);if(recovery)await reply(recovery);await reply(`会话：${this.state.users[userId]?.threadId ?? '尚未创建'}\n状态：${({connecting:'正在连接',idle:'空闲',running:'处理中',stopping:'正在停止',delivering:'正在发送最终回复',closed:'已断开'})[runtime?.state] ?? (runtime?.connecting?'正在连接':runtime?.busy?'处理中':runtime?.finishing?'正在发送最终回复':'空闲')}，排队 ${(runtime?.queue.length??0)+(this.submissions?.pending().filter(j=>j.owner===userId&&j.state==='pending').length??0)} 条，待答复 ${[...this.questions.values()].filter(q => q.session.userId === userId).length} 条。\n未确认任务：${this.submissions?.uncertainCount?.(userId)??0} 条，需核对后再决定是否重试。\n目录：${this.workspaceFor(userId)}\n底座：${this.agentName}\n运行环境：${this.backend?.kind==='podman'?'独立容器 '+this.backend.id:'宿主机'}。`); return }
      if(command?.action==='recover'){
        const n=this.submissions?.recheck?.(userId)??0
        if(n)this.wakeRecovery?.(userId)
        await reply(n?`已安排核对 ${n} 条未确认任务，只查询原任务，不重新执行。稍后用 “状态” 查看。`:'没有可自动核对的未确认任务；缺少会话关联的记录不能安全重提。')
        return
      }
      if (command?.action === 'result') {
        const record=this.state.users[userId]
        if(record?.recovery)await reply(this.ports.recoveryText(record.recovery))
        if(['running','unknown','waiting_attachment'].includes(record?.recovery?.execution))return
        const resultSession={userId,reply,workToken:token}
        if(record?.lastOutput){const output=this.outputStore.replay(record.lastOutput);record.lastOutput=output;await this.save();await this.emit(resultSession,output);this.setRecoveryDelivery(record.recovery,resultSession);await this.save()}
        else {await this.emit(resultSession,record?.lastReply??'尚无历史回复。');this.setRecoveryDelivery(record?.recovery,resultSession);await this.save()}
        return
      }
      if (command?.action === 'stop' || command?.action === 'exit') {
        this.lifecycle.cancel(userId)
        if(this.state.users[userId]?.waitingAttachment){delete this.state.users[userId].waitingAttachment;if(this.state.users[userId].recovery)this.state.users[userId].recovery.execution='interrupted';await this.save()}
        const scopeId=runtime?.threadId??this.state.users[userId]?.threadId
        // Seal remote submission before local interruption, then stop owned daemon work.
        let remoteStop
        const stopRemote=async()=>{if(!remoteStop)remoteStop=this.remoteControl(this.cwd,scopeId,'stop');const result=await remoteStop;if(result.tasks?.length)await reply(result.stop_confirmed?'本对话委托的远程任务及对应命令已确认停止。':'远程任务尚未全部确认停止，请保留会话并重试 “停止”。');if(!result.stop_confirmed)throw Error('远程停止未确认');return result}
        if (!runtime || runtime.rpc.closed) { await stopRemote(); await reply(`当前没有运行中的本地 ${this.agentName} 任务。`); return }
        const queued=runtime.queue.length;runtime.queue=[]
        const stopTrace=runtime.traceId
        let localInterrupt
        const interruptOnce=()=>{if(runtime.traceId!==stopTrace)return Promise.resolve();return localInterrupt??=this.interrupt(runtime)}
        let localStopError
        try{await this.remoteControl(this.cwd,scopeId,'seal')}catch(error){localStopError=error}
        try{if(runtime.busy&&!runtime.connecting)await interruptOnce()}catch(error){localStopError??=error}
        await stopRemote()
        if(localStopError)throw localStopError
        runtime.reply = reply
        if (command.action === 'stop') {
          runtime.queue=[]
          if(runtime.connecting){await reply('已取消待启动任务并清空排队消息。');return}
          if (!runtime.busy) { await reply(runtime.finishing?'已清空排队消息；上一轮最终回复仍在发送。':queued?'已清空排队消息，当前没有运行中的任务。':'当前没有运行中的任务。'); return }
          await interruptOnce()
          if (runtime.busy) await reply('已请求停止当前任务，并清空排队消息。')
        } else if (runtime.busy) {
          if (runtime.exiting) { await reply('正在停止并退出，请等待确认。'); return }
          runtime.exiting = true
          runtime.queue = []
          runtime.exitTimer = setTimeout(() => this.finishExit(runtime, '未收到停止确认，连接已断开。').catch(() => {}), 30_000)
          await reply('正在停止任务并断开会话。')
          try { await interruptOnce() } catch { await this.finishExit(runtime, '停止请求未获确认，连接已断开。') }
        } else await this.finishExit(runtime)
        return
      }
      if (['new', 'reset'].includes(command?.action)) {
        if(runtime?.selecting)throw new Error('正在切换对话，请稍后再试。')
        if(runtime?.finishing)throw new Error('上一轮最终回复仍在发送，请稍后再新建对话。')
        if (runtime?.busy) throw new Error('当前仍有任务，请先发 “停止”。')
        this.lifecycle.cancel(userId)
        if(runtime)transition(runtime,'closed')
        runtime?.rpc.close()
        this.sessions.delete(userId)
        const saved = this.state.users[userId]
        this.state.users[userId] = { seen: saved?.seen, previous: [...(saved?.previous ?? []), ...(saved?.threadId ? [saved.threadId] : [])].slice(-20) }
        await this.save()
        await this.connect(userId, reply)
        await reply(`已新建 ${this.agentName} 对话。`)
        return
      }
      const session = await this.connect(userId, reply)
      if(!token.current()){this.diagnostic(session,'turn.cancelled',{reason:'cancelled_generation'});return}
      await this.send(session, text, token)
    } catch (error) {
      if(!command&&!token.current()){this.log('turn.cancelled',{userId,reason:'cancelled_generation'});return}
      this.log('session.handle_failed',{userId,...this.ports.errorFields(error)})
      await reply(`${this.agentName}：${error.message}`)
    }
  }
  async ask(userId, text, reply = async () => {}, timeout = 180_000, token = this.lifecycle.capture(userId)) {
    if(!token.current())return {status:'interrupted',reply:'任务已取消。'}
    const session = await this.connect(userId, reply)
    if(!token.current())return {status:'interrupted',reply:'任务已取消。'}
    if (session.busy) throw new Error('Test session is busy')
    let resolveResult
    let timer
    const result = new Promise((resolve, reject) => {
      resolveResult = value => { clearTimeout(timer); resolve(value) }
      session.waiters ??= new Set()
      session.waiters.add(resolveResult)
      timer = setTimeout(() => { session.waiters.delete(resolveResult); reject(new Error('Codex test timed out')) }, timeout)
    })
    try { await this.send(session, text, token); return await result }
    finally { clearTimeout(timer); session.waiters.delete(resolveResult) }
  }
  close() {
    this.lifecycle.close()
    for (const session of this.sessions.values()) {
      transition(session,'closed')
      clearTimeout(session.exitTimer)
      this.clearQuestions(session)
      session.rpc.close()
    }
    this.sessions.clear()
  }
}
