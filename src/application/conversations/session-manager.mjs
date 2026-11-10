import {homedir as platformHome} from 'node:os'
import {emptyContinuationNotice} from '../../domain/delivery/notification-policy.mjs'
import {currentMaterials,hasAttachments} from '../../domain/messages/material-association.mjs'
import {executionState} from '../../domain/tasks/execution-state.mjs'
import {localTaskLabel,localCompletion} from '../../domain/tasks/task-label.mjs'
import {transition} from '../../domain/tasks/lifecycle.mjs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const goalStatusText=status=>({active:'已启用',paused:'已暂停',complete:'已完成'})[status]??'未知'

export class SessionManager {
  constructor({ stateDir, cwd, owners, backend = null, codexHome, sessionProtocol, sessionPorts, completionMarkers = false, scheduleGuidance = '', log = () => {} }) {
    if (typeof sessionPorts?.assistantInstructions !== 'string' ||
      ['integrationGuidance','materialInput','flowInput','stripTaskFlow','recoveryText','outputStore','outputLinks','errorFields','deliveryError','deliveryFailureState','systemNotice','controlCommand','cancellationScopes'].some(name=>typeof sessionPorts[name]!=='function')) throw Error('SESSION_PORTS_REQUIRED')
    this.ports=sessionPorts
    this.log = log
    if(!sessionProtocol)throw Error('SESSION_PROTOCOL_REQUIRED')
    this.protocol=sessionProtocol
    this.supportsNativeCommands=sessionProtocol.supportsNativeCommands
    this.agentName=sessionProtocol.name
    this.backend=backend
    this.instructions=this.ports.assistantInstructions+(backend?.instructions?'\n'+backend.instructions:'')
    this.completionMarkers = completionMarkers
    this.lifecycle = this.ports.cancellationScopes()
    this.stateDir = stateDir
    this.cwd = cwd
    this.submissions=null
    this.outputStore=this.ports.outputStore({stateDir,cwd:backend?.workspace??cwd,generatedRoot:codexHome?join(codexHome,'generated_images'):undefined,fileReader:backend?.fileReader,voiceMode:process.env.WECHAT_NATIVE_VOICE_EXPERIMENTAL==='1'?'native':'file'})
    this.owners = new Set(owners)
    this.rpcFactory = options => sessionProtocol.createRpc({...options,errorFields:this.ports.errorFields})
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
  async emit(session, text, guard = () => true, acceptedOnly = false) {
    const context={userId:session.userId,thread_id:session.threadId,turn_id:session.turnId,trace_id:session.traceId}
    session.delivering = (session.delivering ?? Promise.resolve()).catch(() => {}).then(async()=>{
      if(!guard()){session.lastDelivery={status:'cancelled',updated:new Date().toISOString()};this.log('delivery.suppressed',{...context,reason:'stale_progress',delivery_state:'cancelled'});return false}
      const started=Date.now();this.log('delivery.started',{...context,chars:Array.from(typeof text==='string'?text:text.text).length})
      try{
        const sent=await session.reply(text,{checkpoint:()=>this.save(),current:()=>session.workToken?.current()??true,traceId:session.traceId})
        const state=['accepted','deferred','partial','unknown','cancelled','failed'].includes(sent?.status)?sent.status:'unknown'
        session.lastDelivery={status:state,updated:new Date().toISOString(),...(sent?.error?{error:sent.error}:{})}
        if(state==='accepted')session.contextRejected=false
        this.log('delivery.completed',{...context,status:state,delivery_state:state,duration_ms:Date.now()-started})
        return state==='accepted'||!acceptedOnly&&state==='deferred'
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
  outputStoreFor(userId){return this.state.users[userId]?.workspace?this.ports.outputStore({stateDir:this.stateDir,cwd:this.workspaceFor(userId),generatedRoot:this.outputStore.generatedRoot,voiceMode:this.outputStore.voiceMode}):this.outputStore}
  createCatalogRpc(){return this.rpcFactory({cwd:this.cwd,provider:'configured',providerOptions:this.providerOptions(),onEvent:()=>{},onClose:()=>{},log:this.log})}
  providerOptions() {
    return this.protocol.providerOptions()
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
    const guidance=this.backend && this.backend.kind !== 'host' ? '' : await this.ports.integrationGuidance({stateDir:this.stateDir})
    const workspaceRules=await this.protocol.workspaceRules(this.workspaceFor(userId))
    return this.instructions+(this.backend?.kind === 'host' && this.scheduleGuidance ? '\n\n'+this.scheduleGuidance : '')+(guidance?'\n\n'+guidance:'')+workspaceRules
  }
  async startProvider(session) {
    const provider='configured',attempt=this.attachRpc(session)
    const saved=this.state.users[session.userId]??={}
    try {
      await this.protocol.initialize(attempt.rpc)
      if(session.exited||attempt.rpc.closed)throw Error('会话已取消连接。')
      const result=await this.protocol.open(attempt.rpc,{saved,cwd:this.workspaceFor(session.userId),instructions:await this.sessionInstructions(session.userId),provider:attempt.providerOptions})
      if(session.exited||attempt.rpc.closed)throw Error('会话已取消连接。')
      session.provider=provider
      session.model=result.model
      session.modelProvider=result.modelProvider??attempt.providerOptions.provider??null
      session.threadId=saved.threadId=result.thread.id
      session.compacting=saved.compaction?.threadId===session.threadId
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
  async clearCompaction(session) {
    session.compacting=false
    const record=this.state.users[session.userId]
    if(record?.compaction?.threadId!==session.threadId)return
    delete record.compaction
    try{await this.save()}catch(error){this.diagnostic(session,'compaction.save_failed',this.ports.errorFields(error))}
  }
  async listConversations(userId,reply,{selecting=false}={}) {
    const ids=this.conversationIds(userId)
    if(!ids.length){await reply('暂无可恢复的会话。');return}
    const session=await this.connect(userId,reply),lines=[]
    for(const [index,id] of ids.entries()){
      let title='历史对话'
      try{const thread=await this.protocol.read(session.rpc,id);if(thread?.id===id&&thread.name)title=String(thread.name).replace(/[\r\n]/g,' ').slice(0,60)}catch{title='暂不可读取，恢复时会核验'}
      lines.push(`${index+1}. ${id===session.threadId?'[当前] ':''}${title}（${id}）`)
    }
    this.state.users[userId].conversationChoices=ids;await this.save()
    await reply('你保存的会话：\n'+lines.join('\n')+(selecting?'\n回复编号即可切换；发送“取消”放弃。':'\n发送“恢复会话”后可按编号切换。'))
  }
  async listRecentCommits(userId,reply){
    const cwd=this.workspaceFor(userId),commits=await this.ports.recentCommits(cwd)
    if(!commits.length){await reply('没有找到可审查的提交，请检查当前项目目录。');return false}
    this.state.users[userId]??={}
    this.state.users[userId].reviewChoices={cwd,ids:commits.map(commit=>commit.sha)}
    await this.save()
    await reply('最近的提交：\n'+commits.map((commit,index)=>`${index+1}. ${commit.title}`).join('\n')+'\n回复编号开始审查；发送“取消”放弃。')
    return true
  }
  resolveReviewCommit(userId,selection){
    const choices=this.state.users[userId]?.reviewChoices,index=Number(selection)-1
    if(!/^\d{1,2}$/.test(String(selection))||!choices||choices.cwd!==this.workspaceFor(userId)||!choices.ids?.[index])throw Error('请重新发送“审查提交”并选择列表中的编号。')
    return {action:'review',target:{type:'commit',sha:choices.ids[index]}}
  }
  async resumeConversation(userId,selection,reply,token) {
    if(!selection){await this.listConversations(userId,reply);return}
    const saved=this.state.users[userId]??{},ids=this.conversationIds(userId)
    const id=/^[0-9]+$/.test(selection)?saved.conversationChoices?.[Number(selection)-1]:selection
    if(!id||!ids.includes(id))throw Error('请选择本账号会话列表中的编号。')
    const busy=()=>{const r=this.sessions.get(userId);return r&&(r.busy||r.finishing||r.connecting||r.selecting||r.exiting||r.queue?.length||r.state==='stopping')}
    if(busy()||(this.submissions?.pending?.()??[]).some(j=>j.owner===userId)||this.submissions?.uncertainCount?.(userId))throw Error('仍有执行、排队或未确认任务，请先处理完再切换对话。')
    const session=await this.connect(userId,reply)
    if(!token.current())return
    if(busy())throw Error('会话正在处理其他操作，请稍后再切换。')
    if(id===session.threadId){await reply('当前已在该对话中，直接发消息即可。');return}
    session.selecting=true
    try{
      const meta=await this.protocol.read(session.rpc,id)
      if(meta?.id!==id||meta.cwd&&meta.cwd!==this.workspaceFor(userId))throw Error('历史对话目录不匹配，未切换。')
      if(meta.status?.type==='active')throw Error('目标对话正在执行任务，未切换。')
      const selectedProvider=this.providerOptions()
      const result=await this.protocol.resume(session.rpc,{threadId:id,cwd:this.workspaceFor(session.userId),instructions:await this.sessionInstructions(session.userId),provider:selectedProvider})
      if(!token.current())return
      const previous=this.state.users[userId],oldId=session.threadId
      const next={seen:previous.seen,workspace:previous.workspace,previous:ids.filter(v=>v!==id).reverse().slice(-20),threadId:id,hasMessages:true,conversationChoices:previous.conversationChoices,fastMode:previous.fastMode}
      this.state.users[userId]=next;session.threadId=id
      try{await this.save()}catch(e){if(this.state.users[userId]===next){this.state.users[userId]=previous;session.threadId=oldId}throw e}
      this.lifecycle.cancel(userId)
      this.clearQuestions(session);session.items.clear();session.finals=[];session.localTask=null;session.lastProgress=null;session.turnId=null;session.attachmentContinuation=null;session.model=result.model;session.modelProvider=result.modelProvider??selectedProvider.provider??session.modelProvider
      this.diagnostic(session,'session.selected',{previous_thread_id:oldId})
      await reply('已恢复对话 '+id+'，下一条消息将在该对话中继续。')
    }finally{session.selecting=false}
  }
  async send(session, text, token = this.lifecycle.capture(session.userId), native = null) {
    native??=typeof text==='object'?text.nativeCommand:null
    if(!token.current())return
    if (session.exited || session.rpc.closed) return
    const compactionDeadline=Date.now()+30_000
    while((session.compacting||session.compactionStarting)&&token.current()&&!session.rpc.closed){
      if(!session.compactionStarting){
        let thread
        try{thread=await this.protocol.read(session.rpc,session.threadId)}catch(error){throw Object.assign(Error('Codex 上下文压缩状态核对失败，本条任务未提交。'),{code:'COMPACTION_CHECK_FAILED',cause:error})}
        if(thread?.status?.type!=='active'){await this.clearCompaction(session);break}
      }
      if(Date.now()>=compactionDeadline)throw Object.assign(Error('Codex 上下文压缩仍未完成，本条任务未提交；请稍后重试。'),{code:'COMPACTION_WAIT_TIMEOUT'})
      await new Promise(resolve=>setTimeout(resolve,500))
    }
    if(!token.current())throw Error('等待上下文压缩期间任务已取消。')
    if(session.rpc.closed)throw Object.assign(Error('等待上下文压缩期间连接已关闭，本条任务未提交。'),{code:'COMPACTION_CHECK_FAILED'})
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
      if(!token.current()){if(!session.exited&&session.traceId===traceId){transition(session,'idle');session.turnReady=true;this.resolveWaiters(session,{status:'interrupted',reply:'任务已取消。'})}return}
      const deliveryId=typeof text==='object'?text.deliveryId:undefined
      if(deliveryId){this.submissions?.context?.(deliveryId,{task:session.localTask,request:session.requestText,continuation:session.attachmentContinuation,flowNonce:session.traceId,materials:currentMaterials(text,deliveryId)});this.submissions?.bind(deliveryId,session.threadId)}
      const materials=currentMaterials(text,deliveryId??session.traceId),pendingMaterials=this.submissions?.pendingMaterials?.(session.userId,deliveryId)??0
      session.materials=materials
      this.diagnostic(session,'materials.context',{count:materials.length,queue_depth:pendingMaterials,reason:session.attachmentContinuation?'continuation':materials.length?'current':'unbound'})
      const runtimeInput=this.backend?.prepareInput?await this.backend.prepareInput(text,{signal:token.signal}):text
      const turnParams={threadId:session.threadId,input:[...this.protocol.input(runtimeInput),this.ports.flowInput(session.traceId),this.ports.materialInput({materials,pending:pendingMaterials,continuation:!!session.attachmentContinuation}),...(session.attachmentContinuation?[{type:'text',text:'当前附件用于继续此前等待中的用户请求（保持原授权范围）：'+JSON.stringify(session.attachmentContinuation.request)}]:[])],...(deliveryId?{clientUserMessageId:deliveryId}:{})}
      result=native?.action==='review'
        ?await this.protocol.startReview(session.rpc,session.threadId,native.target)
        :await this.protocol.startTurn(session.rpc,{threadId:turnParams.threadId,input:turnParams.input,deliveryId,plan:native?.action==='plan',model:session.model,fastMode:this.state.users[session.userId]?.fastMode})
      if(!result?.turn?.id)throw Error('底座未确认任务标识，结果待核对。')
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
      try { const result=await this.protocol.interrupt(session.rpc,session.threadId,session.turnId);if(this.backend?.stopBackground)await this.backend.stopBackground(session);return result }
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
    if(message.method==='thread/compacted'&&p.threadId===session.threadId){await this.clearCompaction(session);return}
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
        await this.notify(session, `${this.agentName} 请求了暂不支持的交互：${message.method}，该请求未获执行。`)
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
        this.notify(session, '这项请求已过期，未予批准。')
      }, 10 * 60_000)
      this.questions.set(code, question)
      this.diagnostic(session,'interaction.requested',{method:message.method})
      let text
      if (message.method === 'item/tool/requestUserInput') {
        text = p.questions.map((q, i) => `${i + 1}. ${q.question}${q.options?.length ? '\n' + q.options.map(o => `${o.label}：${o.description}`).join('\n') : ''}`).join('\n\n')
        text += '\n\n发送“回答”，选择问题后输入答案。'
      } else {
        text = `${p.reason ?? `${this.agentName} 请求批准操作`}\n目录：${p.cwd ?? this.cwd}\n${p.command ?? JSON.stringify(item?.changes ?? p.permissions ?? p.networkApprovalContext)}\n\n发送“批准”或“拒绝”，再从列表中选择操作。`
      }
      await this.notify(session, text)
      return
    }
    if(message.method==='error'){
      const code=this.protocol.eventCode(p)
      if(code)this.diagnostic(session,'provider.event_error',{provider:session.provider,stage:session.turnStarted?'turn':'turn_start',reason:code,rpc_code:code})
      return
    }
    if (message.method === 'turn/started' && session.busy) {
      if(session.turnReady&&session.turnId&&p.turn?.id!==session.turnId){this.diagnostic(session,'event.ignored',{reason:'other_turn',method:message.method});return}
      session.turnReady = true; session.turnStarted = true; session.turnId = p.turn.id
      this.diagnostic(session,'turn.started',{provider:session.provider,model:session.model,model_provider:session.modelProvider})
    }
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
        const flow=this.ports.stripTaskFlow(this.protocol.cleanOutputText(p.item.text),session.traceId)
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
    if(!text){await reply('请先发送“补充”，再按提示输入内容。');return}
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
      const result=await this.protocol.steer(rpc,threadId,turnId,text)
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
  async handle(userId, text, reply, messageId, token = this.lifecycle.capture(userId), parsedCommand) {
    if (!this.owners.has(userId)) { await reply('当前微信账号未获授权。'); return }
    if (!await this.acceptMessage(userId,messageId)) return
    let command = parsedCommand??(typeof text === 'string' ? this.ports.controlCommand(text) : null)
    if(!command&&!token.current())return
    this.log('message.handled',{userId,messageId,kind:command?.action??(typeof text==='string'?'text':'media')})
    try {
      if(command?.action==='reviewCommit'){
        command=this.resolveReviewCommit(userId,command.selection)
      }
      if(command?.action==='steer'){await this.steer(userId,command.text,reply,token);return}
      if(command?.action==='memory'){
        if(!this.protocol.supportsMemory){await reply(await this.protocol.memory(null,null,command));return}
        const session=await this.connect(userId,reply)
        await reply(await this.protocol.memory(session.rpc,session.threadId,command));return
      }
      if (['approval', 'answer'].includes(command?.action)) {
        const question = this.questions.get(command.code)
        if (!question || question.session.userId !== userId) throw new Error('请求已过期、不存在或不属于当前账号。')
        const { session, message } = question
        const isQuestion = message.method === 'item/tool/requestUserInput'
        if ((command.action === 'answer') !== isQuestion) throw new Error(isQuestion ? '请发送“回答”选择问题。' : '请发送“批准”或“拒绝”选择操作。')
        let result
        if (isQuestion) {
          const answers = command.text.split('|').map(s => s.trim())
          if (answers.length !== message.params.questions.length) throw new Error('请用 | 分隔每个问题的答案。')
          result = { answers: Object.fromEntries(message.params.questions.map((q, i) => [q.id, { answers: [answers[i]] }])) }
        } else result = command.accept ? message.method === 'item/permissions/requestApproval' ? { permissions: message.params.permissions, scope: 'turn' } : { decision: 'accept' } : this.deny(message.method)
        session.rpc.respond(message.id, result)
        clearTimeout(question.timer)
        this.questions.delete(command.code)
        await reply(`已将答复发送给 ${this.agentName}。`)
        return
      }
      if(command?.action==='resume'){await this.resumeConversation(userId,command.selection,reply,token);return}
      if(command?.action==='models'){
        if(!this.protocol.supportsModels){await reply(await this.protocol.models(null));return}
        const session=await this.connect(userId,reply)
        await reply(await this.protocol.models(session.rpc,session.model));return
      }
      if(['goal','plan','review','compact','fork','agentStatus','fast'].includes(command?.action)){
        if(!this.protocol.supportsNativeCommands){await reply(`当前 ${this.agentName} 底座未接入这项原生命令；没有执行。`);return}
        const session=await this.connect(userId,reply)
        if(!token.current())return
        if(command.action==='goal'){
          if(command.op==='invalidBudget'){await reply('长任务预算必须是正整数，最多 9 位。');return}
          const goal=await this.protocol.goal(session.rpc,session.threadId,command)
          const next=(command.op==='create'||command.op==='resume')?'\n目标已保存；直接发送具体任务才会执行。':''
          await reply(goal?`长任务：${goal.objective??'未提供目标'}\n状态：${goalStatusText(goal.status)}。${next}`:'当前没有长任务。');return
        }
        if(command.action==='agentStatus'){
          const thread=await this.protocol.read(session.rpc,session.threadId)
          if(session.compacting&&!session.compactionStarting&&thread.status?.type!=='active')await this.clearCompaction(session)
          const goal=await this.protocol.goal(session.rpc,session.threadId,{op:'get'})
          await reply(`会话：${thread.id}\n状态：${thread.status?.type??'未知'}\n长任务：${goal?goalStatusText(goal.status):'无'}\n上下文压缩：${session.compacting?'进行中或待核对':'无待确认'}\n快速模式：${this.state.users[userId]?.fastMode?'开启':'关闭'}。`);return
        }
        if(command.action==='fast'){
          if(session.busy||session.finishing||session.queue.length)throw Error('请等待当前任务及排队消息结束后再切换快速模式。')
          const saved=this.state.users[userId],before=saved.fastMode
          saved.fastMode=command.enabled
          try{await this.save()}catch(error){saved.fastMode=before;throw error}
          await reply(`快速模式已${command.enabled?'开启':'关闭'}；下一轮 Codex 任务生效。`);return
        }
        if(session.busy||session.finishing||session.connecting||session.selecting||session.queue.length||(this.submissions?.pending?.()??[]).some(j=>j.owner===userId)||this.submissions?.uncertainCount?.(userId))throw Error('当前仍有执行、排队或未确认任务，请先核对后再操作。')
        if(session.compactionStarting)throw Error('Codex 正在启动上下文压缩，请稍后再操作。')
        if(session.compacting){
          const thread=await this.protocol.read(session.rpc,session.threadId)
          if(thread?.status?.type==='active')throw Error('Codex 正在压缩上下文，请完成后再操作。')
          await this.clearCompaction(session)
        }
        if(command.action==='compact'){
          const saved=this.state.users[userId],before=saved.compaction
          session.compactionStarting=true
          saved.compaction={threadId:session.threadId,requestedAt:new Date().toISOString()}
          try{await this.save()}catch(error){saved.compaction=before;session.compactionStarting=false;throw error}
          session.compacting=true
          try{await this.protocol.compact(session.rpc,session.threadId)}finally{session.compactionStarting=false}
          await reply('Codex 已接受上下文压缩请求；完成后可继续提交任务。');return
        }
        if(command.action==='fork'){
          session.selecting=true
          try{
            const sourceId=session.threadId,result=await this.protocol.fork(session.rpc,sourceId),id=result?.thread?.id
            if(!id||id===sourceId||result.thread.cwd&&result.thread.cwd!==this.workspaceFor(userId))throw Error('底座未确认同目录的新会话，未切换。')
            const saved=this.state.users[userId]
            const withFork={...saved,previous:[...(saved.previous??[]),id].slice(-20)}
            this.state.users[userId]=withFork
            try{await this.save()}catch(error){this.state.users[userId]=saved;throw Error(`已创建会话 ${id}，但保存归属失败；请在主机核对后恢复。`,{cause:error})}
            if(!command.switchTo){await reply(`已创建旁支会话 ${id}。当前会话不变；发送“恢复会话”后选择旁支即可切换。`);return}
            const resumed=await this.protocol.resume(session.rpc,{threadId:id,cwd:this.workspaceFor(userId),instructions:await this.sessionInstructions(userId),provider:this.providerOptions()})
            if(!token.current())return
            const next={...withFork,threadId:id,previous:[...(saved.previous??[]),sourceId].slice(-20),hasMessages:true}
            this.state.users[userId]=next;session.threadId=id
            try{await this.save()}catch(error){this.state.users[userId]=withFork;session.threadId=sourceId;throw error}
            this.lifecycle.cancel(userId);this.clearQuestions(session);session.items.clear();session.finals=[];session.turnId=null;session.model=resumed.model;session.modelProvider=resumed.modelProvider??session.modelProvider
            await reply(`已分叉并切换到会话 ${id}。`);return
          }finally{session.selecting=false}
        }
        const reviewText=command.target?.type==='commit'?'请审查选定的提交。':command.target?.type==='baseBranch'?'请审查与指定分支相比的改动。':'请审查当前工作区变更。'
        await this.send(session,command.action==='plan'?command.text:reviewText,token,command)
        return
      }
      if (command?.action === 'help') {
        await reply([
          '微信命令列表：',
          '【当前任务】',
          '状态（status）', '进度（progress）', '补充（supplement）', '停止（stop）', '结果（result）', '恢复（recover）', '退出（exit）',
          '【长任务与计划】',
          '长任务（goal）', '长任务状态（goal-status）', '暂停长任务（goal-pause）', '继续长任务（goal-resume）', '完成长任务（goal-complete）', '清除长任务（goal-clear）', '计划（plan）',
          '【代码审查】',
          '代码审查（review）', '对比审查（compare）', '审查提交（commit-review）',
          '【会话】',
          '会话状态（session-status）', '恢复会话（resume-session）', '重置会话（reset-session）', '压缩上下文（compact）', '分叉会话（fork）', '旁支会话（branch）',
          '【项目】',
          '日常（daily）', '列表（list）', '新建（new）', '切换（switch）', '命名（rename）', '历史（history）', '搜索（search）', '归档2（archive2）', '还原2（restore2）', '删除2（delete2）', '当前目录（folder）', '新建项目（new-project）',
          '【模型与记忆】',
          '模型（models）', '开启快速模式（fast-on）', '关闭快速模式（fast-off）', '记忆（memory）', '开启记忆（memory-on）', '关闭记忆（memory-off）',
          '【服务】',
          '安装状态（setup-status）', '安装向导（setup）', '安装智能体（install-agent）', '登录智能体（login-agent）', '验收智能体（check-agent）', '重启（restart）', '升级（upgrade）', '诊断（diagnose）', '服务状态（service-status）', '查看最近错误（recent-errors）', '导出诊断报告（export-diagnostics）', '安装帮助（install-help）', '命令列表（help）', '使用说明（guide）',
          '【交互答复】',
          '批准（approve）', '拒绝（reject）', '回答（answer）',
          '远程主机和设备配置可以直接描述需求。',
          '发送“使用说明”查看各命令用途。',
        ].join('\n'))
        return
      }
      const runtime = this.sessions.get(userId)
      if(command?.action==='progress'){
        const queued=(runtime?.queue.length??0)+(this.submissions?.pending().filter(j=>j.owner===userId&&j.state==='pending').length??0)
        const state=runtime?.state??(runtime?.connecting?'connecting':runtime?.busy?'running':runtime?.finishing?'delivering':'idle')
        const label=({connecting:'正在连接智能体',running:'正在处理',stopping:'正在停止',delivering:'正在发送最终回复',closed:'连接已断开',idle:'当前没有正在执行的任务'})[state]??'当前没有正在执行的任务'
        const latest=['running','delivering'].includes(state)&&runtime?.lastProgress?.turnId===runtime.turnId?`\n最近进展：${runtime.lastProgress.text}`:''
        await reply(`${label}${queued?`；排队 ${queued} 条`:''}。${latest||(['running','connecting'].includes(state)?'\n尚无新的阶段信息。':'')}`)
        return
      }
      if (command?.action === 'status') { try{const root=join((process.env.HOME||platformHome()),'.local/share/wechat-assistant-backups');let b;try{b=JSON.parse(await readFile(join(root,'last-failure.json'),'utf8'));await reply('备份：最近一次失败或因忙碌延后，请检查备份服务。')}catch{b=JSON.parse(await readFile(join(root,'latest.json'),'utf8'));await reply(b.status==='verified'?'备份：'+b.generation+'，NAS校验及隔离恢复通过。':'备份：最近一次未验证成功。')}}catch{} const recovery=this.ports.recoveryText(this.state.users[userId]?.recovery);if(recovery)await reply(recovery);await reply(`会话：${this.state.users[userId]?.threadId ?? '尚未创建'}\n状态：${({connecting:'正在连接',idle:'空闲',running:'处理中',stopping:'正在停止',delivering:'正在发送最终回复',closed:'已断开'})[runtime?.state] ?? (runtime?.connecting?'正在连接':runtime?.busy?'处理中':runtime?.finishing?'正在发送最终回复':'空闲')}，排队 ${(runtime?.queue.length??0)+(this.submissions?.pending().filter(j=>j.owner===userId&&j.state==='pending').length??0)} 条，待答复 ${[...this.questions.values()].filter(q => q.session.userId === userId).length} 条。\n未确认任务：${this.submissions?.uncertainCount?.(userId)??0} 条，需核对后再决定是否重试。\n目录：${this.workspaceFor(userId)}\n底座：${this.agentName}\n运行环境：宿主机。`); return }
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
        if(runtime?.compacting||this.state.users[userId]?.compaction?.threadId===scopeId)await reply('上下文压缩可能仍在进行；本次停止未确认取消压缩。新任务会先核对状态。')
        if (!runtime || runtime.rpc.closed) { await reply(`当前没有运行中的本地 ${this.agentName} 任务。`); return }
        const queued=runtime.queue.length;runtime.queue=[]
        const stopTrace=runtime.traceId
        let localInterrupt
        const interruptOnce=()=>{if(runtime.traceId!==stopTrace)return Promise.resolve();return localInterrupt??=this.interrupt(runtime)}
        let localStopError
        try{if(runtime.busy&&!runtime.connecting)await interruptOnce()}catch(error){localStopError??=error}
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
      timer = setTimeout(() => { session.waiters.delete(resolveResult); reject(new Error('Agent test timed out')) }, timeout)
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
