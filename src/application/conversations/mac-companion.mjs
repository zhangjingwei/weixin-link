import {createHash} from 'node:crypto'
import {basename,join,resolve,sep} from 'node:path'
import {historyInputText} from './history.mjs'

export function macCompanion({access,owner,conversations,manager,jobs,stateDir,submit,notice,ready}){
 const stale=()=>{throw Object.assign(Error('COMPANION_STALE'),{statusCode:409})}
 return async request=>{
  const catalog=conversations.ensure(owner),entries=catalog.entries.filter(item=>!item.archived&&!item.deleted)
  const viewing=request.action==='view',selected=viewing&&request.project!==undefined?request.project:catalog.active
  const entry=entries.find(item=>item.id===selected)
  if(!entry||entry.deleted||entry.archived)throw Error('COMPANION_NO_CONVERSATION')
  const key=entry.key,record=manager.state.users[key]??{},session=manager.sessions.get(key),state=access.read()
  const thread=record.threadId??'',turn=session?.state==='running'&&!session.finalReceived?session.turnId??'':''
  const identity={project:entry.id,thread,turn}
  if(request.action==='view'){
   const messages=[],files=[],hash=createHash('sha256').update(key).digest('hex').slice(0,24)
   const addFiles=(parts,folder)=>{for(const item of parts??[]){const root=join(stateDir,folder,hash)+sep;if(typeof item.path==='string'&&resolve(item.path).startsWith(root))files.push({name:basename(item.fileName??item.name??item.path),path:resolve(item.path)})}}
   for(const job of jobs.companionMessages(key,thread)){
    const text=historyInputText(job.text??'').split('\n\n附件接入说明：')[0]
    messages.push({role:'你',text:text||'附件',time:job.created});addFiles(JSON.parse(job.files),'attachments')
   }
   for(const item of record.supplements??[]){if(item.threadId===thread)messages.push({role:'补充 · '+item.status,text:item.text,time:Date.parse(item.created)})}
   for(const result of [...(record.resultArchive??[]).filter(item=>item.identity.id!==record.resultIdentity?.id),{identity:record.resultIdentity,lastReply:record.lastReply,lastOutput:record.lastOutput}]){
    if(!result.lastReply||result.identity?.threadId!==thread)continue
    messages.push({role:'助手',text:result.lastReply.slice(0,16000),time:Date.parse(result.identity.createdAt)});addFiles(result.lastOutput?.attachments,'outgoing')
   }
   return {...identity,...state,name:entry.name,activeProject:catalog.active,conversations:entries.map(({id,name})=>({id,name})),messages:messages.sort((left,right)=>left.time-right.time).slice(-40),files:files.slice(-40)}
  }
  if(!ready()||manager.state.desktopHandoff||manager.desktopTransition)throw Error('COMPANION_UNAVAILABLE')
  if(request.project!==entry.id||request.thread!==thread||state.revision!==request.revision)stale()
  if(request.action==='take'){
   const next=access.take('mac',state.revision)
   await notice(owner,`Mac 已接手，微信只读。回复「微信接手 ${next.revision}」可接回。`).catch(()=>{})
   return {status:'taken'}
  }
  if(state.writer!=='mac'||request.turn!==turn)stale()
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>12000||!/^[-\da-f]{36}$/i.test(request.id??''))throw Error('COMPANION_INVALID_TEXT')
  if(request.action==='steer'&&turn){
   const token=manager.lifecycle.capture(key)
   if(!jobs.claimReceipt('mac-steer:'+request.id))return {status:'unknown'}
   const result=await manager.steer(key,request.text,()=>{},{...token,current:()=>token.current()&&access.read().revision===state.revision},{traceId:session.traceId,turnId:turn})
   if(result?.status==='accepted')await notice(owner,'Mac 补充：'+request.text).catch(()=>{})
   return result
  }
  if(request.action!=='send'||turn||session?.busy||session?.finishing)stale()
  const id=submit(key,{text:request.text},'mac:'+request.id)
  if(jobs.claimReceipt('mac-notice:'+id))await notice(owner,'Mac 发来：'+request.text).catch(()=>{})
  return {status:'queued',id}
 }
}
