// Route by the connection's immutable identity, never by the latest UI selection.
export function createMultiAgentProtocol(protocols){
 const get=kind=>{const protocol=Object.hasOwn(protocols,kind)&&protocols[kind];if(!protocol)throw Error('AGENT_UNAVAILABLE');return protocol}
 const methods=['initialize','open','resume','read','recoverTurn','startTurn','interrupt','steer','memory','models','listModels','unsubscribe','enqueue','removeQueued','findQueued','startReview','goal','compact','fork']
 const mux={name:null,supportsNativeCommands:false,cleanOutputText:text=>String(text??'').trim(),kind:null,get availableAgents(){return Object.keys(protocols)},forAgent:kind=>Object.hasOwn(protocols,kind)?protocols[kind]:{kind,name:kind,supportsNativeCatalog:false},
  createRpc(options){const kind=options.agentKind,rpc=get(kind).createRpc(options);rpc.agentKind=kind;return rpc},
  providerOptions:kind=>get(kind).providerOptions(),
  input:(input,kind)=>get(kind).input(input),
  workspaceRules:(cwd,kind)=>get(kind).workspaceRules(cwd),
 }
 for(const method of methods)mux[method]=(rpc,...args)=>{
  const protocol=get(rpc?.agentKind)
  if(!protocol[method]){
   if(method==='unsubscribe')return
   throw Error('AGENT_OPERATION_UNSUPPORTED')
  }
  return protocol[method](rpc,...args)
 }
 return mux
}
