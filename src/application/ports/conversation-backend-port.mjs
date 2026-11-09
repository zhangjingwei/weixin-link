// The application owns reconciliation; the backend owns connection and protocol details.
export function defineConversationBackendPort(port){
 const operations=port?.capabilities?.catalog?['withConnection','list','connectionFor','closeSession','readConversation','renameConversation','setArchived','deleteConversation','listTurns','confirmSession']:['confirmSession'];
 if(!port||operations.some(name=>typeof port[name]!=='function'))throw Error('CONVERSATION_BACKEND_PORT_INVALID');
 return port;
}
