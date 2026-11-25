import {historyInputText,historyText} from '../conversations/history.mjs'

export async function searchNativeHistory(context,owner,args,across=false){
 const entry=args.projectId?context.target(owner,args.projectId):null
 const threadId=entry?context.manager.state.users[entry.key]?.threadId:args.threadId
 if((!across&&!entry&&!threadId)||(entry&&args.threadId))throw Error('MANAGEMENT_SEARCH_TARGET_INVALID')
 const state=args.cursor?context.credential(args.cursor,'history-search',owner):null
 const api=context.conversations.backendPort
 if(!api?.searchHistory)throw Error('MANAGEMENT_NATIVE_SEARCH_UNAVAILABLE')
 const scope=across?'sessions':'occurrences',archived=args.archived??false
 if(state&&(state.scope!==scope||state.threadId!==threadId||state.projectId!==args.projectId||state.archived!==archived||state.query!==args.query))throw Error('MANAGEMENT_INVALID_CURSOR')
 if(!args.query.trim())throw Error('MANAGEMENT_QUERY_REQUIRED')
 const page=entry&&!threadId?{matches:[],nextCursor:null}:await context.conversations.withBackend(owner,rpc=>api.searchHistory(rpc,{threadId,query:args.query,archived,cursor:state?.cursor}))
 const matches=page.matches.map(match=>({...match,snippet:historyText(historyInputText(match.snippet)).slice(0,1600)}))
 const nextCursor=page.nextCursor?context.sign({kind:'history-search',owner,scope,threadId,projectId:args.projectId,archived,query:args.query,cursor:page.nextCursor,expires:context.now()+600000}):null
 return {scope,query:args.query,projectId:args.projectId,threadId,matches,nextCursor,complete:!nextCursor,attachmentsResent:false}
}
