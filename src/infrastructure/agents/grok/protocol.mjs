import {createAcpProtocol} from '../acp/protocol.mjs'
import {GrokSession} from './session.mjs'
import {inspectGrok} from './installation.mjs'
export function createGrokProtocol({binary,inspect=inspectGrok,env=process.env}={}){
 return createAcpProtocol({kind:'grok',name:'Grok',Session:GrokSession,binary,inspect,env})
}
