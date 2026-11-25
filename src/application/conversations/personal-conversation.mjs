import {basename,isAbsolute,normalize} from 'node:path'
import {randomUUID} from 'node:crypto'

const label=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,60)
const closedThread=thread=>thread.archived||thread.path?.replaceAll('\\','/').includes('/archived_sessions/')

export async function resumePersonalConversation(context,message,reply){
 const {manager,backendPort}=context,owner=message._conversationOwner,root=context.ensure(owner)
 const command=message._conversationCommand
 const current=()=>root.selectionVersion===message._conversationSelectionVersion&&!manager.state.desktopHandoff&&(!message._intakeToken||message._intakeToken.current())
 if(!current())return
 if(!backendPort?.recentPersonalThreads){await reply('当前连接无法读取电脑上的 Codex 会话。');return}
 let result
 try{
  result=await context.withBackend(owner,async rpc=>{
   const recent=await backendPort.recentPersonalThreads(rpc)
   const candidates=recent.filter(t=>!closedThread(t)&&isAbsolute(t.cwd))
   if(!candidates.length)return {notice:'没有找到电脑上最近保存的 Codex 会话。'}
   const latest=candidates[0]
   if(!command.threadId){
    const choices=command.browse?candidates:candidates.filter(t=>t===latest||!latest.updatedAt||!t.updatedAt||latest.updatedAt-t.updatedAt<=900)
    if(command.browse||choices.length>1)return {choices:choices.map(t=>({id:t.id,name:label(t.name||t.preview)||'未命名会话',folder:label(basename(t.cwd))}))}
   }
   const selected=command.threadId?candidates.find(t=>t.id===command.threadId):latest
   if(!selected)return {notice:'刚才选的会话已不在最近列表里。请再说一次“看看电脑最近的会话”。'}
   const thread=await backendPort.readConversation(rpc,selected.id)
   if(thread?.id!==selected.id||thread.cwd!==selected.cwd||closedThread(thread))throw Error('PERSONAL_THREAD_CHANGED')
   return {thread}
  })
 }catch{result={notice:'暂时无法确认电脑上的原会话，请稍后再试。'}}
 if(!current())return
 if(result.notice){await reply(result.notice);return}
 if(result.choices){
  root.prompt={target:'personalResume',key:message.userId,choices:result.choices}
  await manager.save()
  if(current())await reply('想接着哪一条聊？\n'+result.choices.map((v,i)=>(i+1)+'. '+v.name+'（'+v.folder+'）').join('\n')+'\n告诉我标题、文件夹名或序号都可以。')
  return
 }
 const {thread}=result
 if(!['idle','notLoaded'].includes(thread.status?.type)){await reply('这条会话目前还不能接续。等电脑上这轮结束后，再告诉我继续。');return}
 let entry=root.entries.find(e=>manager.state.users[e.key]?.threadId===thread.id)
 if(entry){
  const session=manager.sessions.get(entry.key)
  if(entry.deleted||entry.archived||entry.deleteIntent||session?.busy||session?.finishing||normalize(manager.workspaceFor(entry.key))!==normalize(thread.cwd)){
   await reply('这条会话的状态或工作目录已经变化，暂时无法接续。');return
  }
 }else{
  const key=owner+'#conversation#'+randomUUID()
  entry={id:String(Math.max(0,...root.entries.map(e=>Number(e.id)||0))+1),key,name:label(thread.name||thread.preview)||'电脑上的会话',titleSource:thread.name?'codex':'placeholder'}
  manager.state.users[key]={activeAgent:'codex',threadId:thread.id,workspace:thread.cwd,hasMessages:true,nativeProjectId:thread.projectId??null}
  root.entries.push(entry)
  manager.owners.add(key)
 }
 root.active=entry.id
 await manager.save()
 if(current())await reply('接下来在“'+entry.name+'”里聊。你可以继续刚才的话题。')
}
