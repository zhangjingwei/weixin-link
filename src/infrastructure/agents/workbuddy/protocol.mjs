import {createAcpProtocol} from '../acp/protocol.mjs'
import {WorkbuddySession} from './session.mjs'
import {inspectWorkbuddy} from './installation.mjs'
export function createWorkbuddyProtocol({binary,inspect=inspectWorkbuddy,env=process.env}={}){
 return createAcpProtocol({kind:'workbuddy',name:'WorkBuddy',Session:WorkbuddySession,binary,inspect,env})
}
