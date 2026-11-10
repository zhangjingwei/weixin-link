import {codexProviderOptions} from './provider-options.mjs'
import {CodexProtocolClient} from './protocol-client.mjs'
import {StdioTransport} from './stdio-transport.mjs'
// The same client can operate on an injected remote wire without starting a local process.
export class CodexRpc extends CodexProtocolClient {
 constructor({cwd,onEvent=()=>{},onClose=()=>{},log=()=>{},binary,codexHome,provider='configured',providerOptions:resolvedProviderOptions,providerSecrets={},transport,errorFields}){
  if(!transport&&!binary)throw Error('CODEX_BINARY_REQUIRED')
  const env={...process.env,TZ:'Asia/Shanghai',...(codexHome?{CODEX_HOME:codexHome}:{})}
  const selectedOptions=resolvedProviderOptions??codexProviderOptions(env)
  for(const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','CODEX_API_KEY','HA_TOKEN','HA_BASE_URL'])if(key!==selectedOptions.credentialEnvKey)delete env[key]
  Object.assign(env,providerSecrets)
  const wire=transport??new StdioTransport({binary,args:selectedOptions.args,cwd,env,log,errorFields})
  super({transport:wire,onEvent,onClose,log,errorFields});this.provider=provider;this.providerOptions=selectedOptions
  wire.onClose=()=>this.disconnect()
 }
}
