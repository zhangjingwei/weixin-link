// The local backend has no authoritative conversation catalog. The session
// manager owns its connection and persistence; this adapter declares the
// operations that may be presented as confirmed remote changes.
export function createLocalConversationBackend(){
 return {
  capabilities:{catalog:false,archive:false,delete:false,history:false,remoteRename:false},
  async confirmSession(session,conversationId){return session?.threadId===conversationId?{id:conversationId}:null}
 }
}
