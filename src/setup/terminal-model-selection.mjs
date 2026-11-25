import {CodexRpc} from '../infrastructure/agents/codex/rpc.mjs'
import {initializeCodex} from '../infrastructure/agents/codex/protocol-operations.mjs'
import {createSessionProtocol} from '../infrastructure/agents/session-protocol.mjs'
import {ensureAccountCodexHome} from '../infrastructure/accounts/codex-home.mjs'
import {systemCodex} from './system-codex.mjs'

// Use the native config API so the chosen default is also honored by Codex.
// Project-specific model overrides continue to take precedence.
export async function selectTerminalModel({accountId='default',home,binary,choose,write,language='zh',rpcFactory=options=>new CodexRpc(options)}={}){
 const codexHome=await ensureAccountCodexHome(accountId,home)
 const rpc=rpcFactory({binary:binary??await systemCodex(home),nativeProfile:true,providerOptions:{args:['app-server']},codexHome,cwd:home})
 const en=language==='en'
 try{
  await initializeCodex(rpc,{name:'zerolink_model_setup',version:'1.0.0'})
  const {models}=await createSessionProtocol().listModels(rpc)
  if(!models.length)throw Error('MODEL_LIST_EMPTY')
  const current=(await rpc.request('config/read',{includeLayers:false})).config?.model
  const safe=text=>String(text).replace(/[\x00-\x1f\x7f-\x9f]/g,' ')
  const prompt=(en?'\nChoose your working model':'\n选择工作模型')+'\n'+(en?'Saves your personal Codex default, shared with the desktop and CLI. New chats use this default; existing chats and project overrides keep their own models.':'将保存为个人 Codex 默认模型，桌面端和命令行也会使用；新会话使用此默认值，已有会话和项目指定的模型保持优先。')+'\n'+models.map((m,i)=>`${i+1}. ${safe(m.displayName||m.model)} (${safe(m.model)})${m.model===current?(en?' [current]':' [当前]'):m.isDefault?(en?' [default]':' [默认]'):''}`).join('\n')+(en?'\n0. Configure later\nChoose: ':'\n0. 稍后选择\n请选择：')
  let choice
  do{choice=await choose(prompt)}while(choice!=='0'&&(!/^[1-9][0-9]*$/.test(choice)||!models[Number(choice)-1]))
  if(choice==='0')return null
  const model=models[Number(choice)-1].model
  await rpc.request('config/value/write',{keyPath:'model',value:model,mergeStrategy:'replace'})
  const confirmed=(await rpc.request('config/read',{includeLayers:false})).config?.model
  if(confirmed!==model)throw Error('MODEL_SELECTION_UNCONFIRMED')
  write((en?'Working model saved: ':'已保存工作模型：')+model)
  return model
 }finally{rpc.close()}
}
