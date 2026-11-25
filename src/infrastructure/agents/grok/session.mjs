import {AcpSession} from '../acp/session.mjs'
import {grokEnvironment} from './environment.mjs'
export class GrokSession extends AcpSession {
 constructor(options){super({...options,kind:'grok',name:'Grok',environment:grokEnvironment,args:()=>['--no-auto-update','agent','stdio'],promptInstructions:true,requireImageCapability:true,authenticate:async(transport,init)=>{
   if(!init.authMethods?.some(method=>method.id==='cached_token'))throw Object.assign(Error('GROK_LOGIN_REQUIRED'),{code:'GROK_LOGIN_REQUIRED'})
   await transport.call('authenticate',{methodId:'cached_token',_meta:{headless:true}})
  },})}
}
