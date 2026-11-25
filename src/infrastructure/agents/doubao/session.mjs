import {AcpSession} from '../acp/session.mjs'
import {doubaoEnvironment} from './environment.mjs'
export class DoubaoSession extends AcpSession {
 constructor(options){super({...options,kind:'doubao',name:'Doubao',environment:doubaoEnvironment,args:()=>['acp','serve'],promptInstructions:true,requireImageCapability:true,})}
}
