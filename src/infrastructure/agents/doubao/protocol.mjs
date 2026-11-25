import {createAcpProtocol} from '../acp/protocol.mjs'
import {DoubaoSession} from './session.mjs'
import {inspectDoubao} from './installation.mjs'
export function createDoubaoProtocol({binary,inspect=inspectDoubao,env=process.env}={}){
 return createAcpProtocol({kind:'doubao',name:'Doubao',Session:DoubaoSession,binary,inspect,env})
}
