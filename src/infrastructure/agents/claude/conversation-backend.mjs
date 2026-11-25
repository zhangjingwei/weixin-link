// Codex catalog, projects, archive and desktop takeover are not Claude operations.
export function createClaudeConversationBackend(manager){
 return {capabilities:{catalog:false,archive:false,delete:false,history:false},
  confirmSession:async(handle,id)=>manager.protocol.read(handle?.rpc??handle,id)}
}
