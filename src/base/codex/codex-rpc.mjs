import {codexProviderOptions} from './provider-options.mjs'
import {CodexProtocolClient} from './protocol-client.mjs'
import {StdioTransport} from './stdio-transport.mjs'
// The same client can operate on an injected remote wire without starting a local process.
export class CodexRpc extends CodexProtocolClient {
 constructor({cwd,onEvent=()=>{},onClose=()=>{},log=()=>{},binary,provider='configured',providerOptions:resolvedProviderOptions,transport,errorFields}){
  if(!transport&&!binary)throw Error('CODEX_BINARY_REQUIRED')
  const env={...process.env,TZ:'Asia/Shanghai'}
  for(const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','CODEX_API_KEY','HA_TOKEN','HA_BASE_URL'])delete env[key]
  const selectedOptions=resolvedProviderOptions??codexProviderOptions(env)
  const wire=transport??new StdioTransport({binary,args:selectedOptions.args,cwd,env,log,errorFields})
  super({transport:wire,onEvent,onClose,log,errorFields});this.provider=provider;this.providerOptions=selectedOptions
  wire.onClose=()=>this.disconnect()
 }
}
