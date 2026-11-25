// Native identities belong to a logical conversation; shared results and files do not.
const fields=['executorId','threadId','hasMessages','previous','modelOverride','fastMode','nativeProjectId','compaction','agentKind','nativeSessionState']
export function activeAgent(record, fallback=null){return record?.activeAgent??record?.agentKind??fallback}
export function syncNativeSession(record,fallback=null){
 const kind=activeAgent(record,fallback)
 record.nativeSessions??={}
 if(!kind)return record.nativeSessions
 record.activeAgent=kind
 record.nativeSessions[kind]=Object.fromEntries(fields.filter(key=>record[key]!==undefined).map(key=>[key,structuredClone(record[key])]))
 return record.nativeSessions
}
export function selectNativeSession(record,kind,fallback=null){
 if(!['codex','claude','workbuddy','doubao','grok'].includes(kind))throw Error('AGENT_UNAVAILABLE')
 syncNativeSession(record,fallback)
 if(record.activeAgent===kind)return false
 for(const key of fields)delete record[key]
 Object.assign(record,structuredClone(record.nativeSessions[kind]??{}),{activeAgent:kind,agentKind:kind})
 return true
}
export function nativeThreadIds(record){
 return [...new Set([record?.threadId,...Object.values(record?.nativeSessions??{}).map(item=>item.threadId)].filter(Boolean))]
}
