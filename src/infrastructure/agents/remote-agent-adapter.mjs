import {RemoteRpc} from './remote-rpc.mjs'

/** Translate remote agent protocol calls into operations used by remote tasks. */
const itemType={userMessage:'user',agentMessage:'answer',commandExecution:'command'}
const item=value=>({...value,type:itemType[value.type]??value.type})
const turn=value=>({...value,items:(value.items??[]).map(item)})
export function createRemoteAgentAdapter(host,config,rpcFactory){return new RemoteAgentAdapter(rpcFactory?rpcFactory(host,config):new RemoteRpc(host,{hostConfig:config}))}
export class RemoteAgentAdapter{
 constructor(rpc){this.rpc=rpc}
 get child(){return this.rpc.child}
 set onEvent(handler){
  this.rpc.onEvent=event=>{
   if(event.method==='item/completed')handler({type:'itemCompleted',threadId:event.params?.threadId,turnId:event.params?.turnId,item:event.params?.item?item(event.params.item):undefined})
  }
 }
 setRecovery(value){this.rpc.setRecovery?.(value)}
 connect(){return this.rpc.connect()}
 close(){this.rpc.close()}
 metadata(path){return this.rpc.call('fs/getMetadata',{path})}
 async readFile(path,timeout){const data=(await this.rpc.call('fs/readFile',{path},timeout)).dataBase64;if(data.length>70*1024*1024)throw Error('ARTIFACT_TOO_LARGE');return Buffer.from(data,'base64')}
 async listSessions({cwd,limit=25,cursor}={}){
  const page=await this.rpc.call('thread/list',{limit,...cwd?{cwd}:{},...cursor?{cursor}:{},sourceKinds:['cli','appServer','exec','vscode']})
  return {sessions:page.data,nextCursor:page.nextCursor}
 }
 async readSession(threadId){return (await this.rpc.call('thread/read',{threadId})).thread}
 async resumeSession(threadId){return (await this.rpc.call('thread/resume',{threadId,excludeTurns:true})).thread}
 async startSession({cwd,sandbox}){return (await this.rpc.call('thread/start',{cwd,approvalPolicy:'never',sandbox:sandbox==='danger-full-access'?'danger-full-access':'workspace-write'})).thread}
 async listTurns(threadId,{limit=25,cursor}={}){
  const page=await this.rpc.call('thread/turns/list',{threadId,limit,sortDirection:'desc',itemsView:'full',...cursor?{cursor}:{}})
  return {turns:page.data.map(turn),nextCursor:page.nextCursor}
 }
 async findTurn(threadId,{turnId,operationId}){
  let cursor
  for(let n=0;n<20;n++){
   const page=await this.listTurns(threadId,{cursor})
   const turn=page.turns.find(t=>turnId?t.id===turnId:(t.items??[]).some(i=>i.type==='user'&&i.clientId===operationId))
   if(turn)return turn
   cursor=page.nextCursor;if(!cursor)break
  }
  return null
 }
 async latestTurn(threadId){return (await this.listTurns(threadId,{limit:1})).turns[0]??null}
 async listTerminals(threadId,{cursor}={}){
  const page=await this.rpc.call('thread/backgroundTerminals/list',{threadId,limit:100,...cursor?{cursor}:{}})
  return {terminals:page.data,nextCursor:page.nextCursor}
 }
 async startTurn(threadId,operationId,prompt){return (await this.rpc.call('turn/start',{threadId,clientUserMessageId:operationId,input:[{type:'text',text:prompt}]})).turn}
 interruptTurn(threadId,turnId){return this.rpc.call('turn/interrupt',{threadId,turnId})}
 terminateTerminal(threadId,processId){return this.rpc.call('thread/backgroundTerminals/terminate',{threadId,processId})}
}
