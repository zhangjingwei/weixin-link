export async function searchHistory(context,owner,args){
 const entry=context.target(owner,args.projectId),state=args.cursor?context.credential(args.cursor,'history-search',owner):{scannedTurns:0}
 if(args.cursor&&(state.projectId!==entry.id||state.query!==args.query))throw Error('MANAGEMENT_INVALID_CURSOR')
 const page=await context.history(owner,entry,state.historyCursor),matches=[],query=args.query;let count=0,tail=state.tail??'',prior=state.prior
 for(const message of page.messages){
  const prefix=message.continued&&prior?.turnId===message.turnId&&prior?.role===message.role&&prior?.offset===message.offset?tail:''
  const text=prefix+message.text,pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');let match
  while((match=pattern.exec(text))){const at=match.index;if(at+match[0].length>prefix.length){count++;if(matches.length<20)matches.push({turnId:message.turnId,role:message.role,offset:message.offset-prefix.length+at,startedAt:message.startedAt??null,snippet:text.slice(Math.max(0,at-160),at+query.length+160)})}}
  tail=text.slice(-Math.max(0,query.length-1));if(query.length===1)tail=''
  prior={turnId:message.turnId,role:message.role,offset:message.offset+message.text.length}
 }
 const current=page.turns?.[0]?.id,scannedTurns=state.scannedTurns+(current&&current!==state.lastTurn?1:0)
 const continuation=page.nextCursor?context.decode(page.nextCursor):null
 const canContinue=page.nextCursor&&(scannedTurns<50||continuation.turnId===current)
 const nextCursor=canContinue?context.sign({kind:'history-search',owner,projectId:entry.id,query:args.query,historyCursor:page.nextCursor,scannedTurns,lastTurn:current,tail,prior,expires:context.now()+600000}):null
 return {projectId:entry.id,query:args.query,matches,totalMatchesInFragment:count,omittedMatchesInFragment:Math.max(0,count-matches.length),scannedTurns,maxTurns:50,fragmentTurns:page.turns??[],nextCursor,complete:!page.nextCursor,limited:!!page.nextCursor&&!canContinue,scope:'最近最多50轮；每次一个完整轮次或其中一段文本；无匹配仅针对已读范围',attachmentsResent:false}
}
