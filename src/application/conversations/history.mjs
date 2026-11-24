import {historyParts} from './history-presentation.mjs'
export function historyText(value){return String(value).replace(/<wechat-memory:[^>]+>[\s\S]*?<\/wechat-memory:[^>]+>/g,'').replace(/<wechat-task:[^>]+>[\s\S]*?<\/wechat-task:[^>]+>/g,'').replace(/!?\[([^\]\n]*)\]\((?:<\/[^>\n]+>|\/[^\s)]+)\)/g,'$1〔历史附件，未重发〕').trim()}

export async function history(context,owner,entry,cmd,reply){if(entry?.deleted){await reply('该会话已永久删除，历史不可读取或还原。');return;}const old=context.pages.get(owner);if(cmd.action==='older'){if(!old){await reply('请说明想看哪个项目的聊天记录。');return;}entry=context.find(owner,old.id);if(!old.cursor){await reply('已到当前可读取历史的最早一页。');return;}}
 const tid=context.manager.state.users[entry.key]?.threadId;if(!tid){await reply('该会话还没有消息。');return;}
 const cursor=cmd.action==='older'?old.cursor:undefined;
 const query=cmd.action==='search'?cmd.q:cmd.action==='older'?old.query:null
 if(query&&context.backendPort.searchHistory){
  if(cmd.action==='older'&&old.threadId!==tid){await reply('会话已变化，请重新搜索。');return}
  const page=await context.withBackend(owner,rpc=>context.backendPort.searchHistory(rpc,{threadId:tid,query,cursor}))
  const snippets=page.matches.map(match=>historyText(historyInputText(match.snippet)).slice(0,1200)).filter(Boolean)
  if(snippets.length){
   const title=`会话${entry.id} · ${entry.name} 搜索结果`
   let block=title
   for(const snippet of snippets){
    if(block.length+snippet.length>2400){await reply(block);block=title}
    block+='\n\n'+snippet
   }
   await reply(block)
  }else await reply('本页没有可显示的匹配片段。')
  context.pages.set(owner,{id:entry.id,threadId:tid,query,cursor:page.nextCursor})
  await reply(page.nextCursor?'回复“翻页”查看更多匹配。':'搜索完毕。')
  return
 }
 const page=await context.withBackend(owner,rpc=>context.backendPort.listTurns(rpc,tid,{limit:cmd.action==='search'?50:5,cursor}));
 const messages=[];
 for(const [index,turn] of [...(page.data??[])].reverse().entries()){
  for(const item of turn.items??[]){
   let text;
   if(item.type==='userMessage')text=(item.content??[]).filter(c=>c.type==='text').map(c=>historyInputText(c.text??'')).filter(Boolean).join('\n');
   else if(item.type==='agentMessage')text=item.text;
   text=historyText(text??'');
   if(text&&(!cmd.q||text.toLowerCase().includes(cmd.q.toLowerCase())))messages.push({role:item.type==='userMessage'?'你':'助手',text,round:index+1,time:turn.startedAt});
  }
 }
 const title=`会话${entry.id} · ${entry.name} ${cmd.action==='search'?'最近50轮搜索结果':'历史'}`;
 const parts=historyParts(messages);
 for(let index=0;index<parts.length;index++){
  await reply(`${title}\n${cmd.action==='older'?'更早记录':'最近记录'} · 本页从早到晚，最新在下 · ${index+1}/${parts.length}\n\n${parts[index]}`);
 }
 // Advance only after every part has been handed to the existing delivery path.
 context.pages.set(owner,{id:entry.id,cursor:page.nextCursor});
 await reply(page.nextCursor?'本页已展示完。这是备用历史入口，继续看更早记录需回复“翻页”。'+(cmd.action==='search'?'搜索仅覆盖本次读取的最近50轮。':''):'本页已完整展示，已到当前可读取历史的最早记录。');
}

// Generated input metadata may share a text block with the original request.
export function historyInputText(value){
 const text=String(value);
 const marker=/(?:接入层任务状态元数据 nonce=|接入层记忆元数据 nonce=|本轮材料关联状态[（(:：]|相关记忆（仅资料|当前附件用于继续)/.exec(text);
 return (marker?text.slice(0,marker.index):text).trim();
}
