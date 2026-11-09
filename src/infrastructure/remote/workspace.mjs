import {isAbsolute} from 'node:path'
import {installConfig} from '../../setup/install-config.mjs'

export function resolveRemoteWorkspace({home,workspace,env=process.env}={}) {
 const root=workspace??env.WECHAT_REMOTE_WORKSPACE??installConfig(home).workspace
 if(typeof root!=='string'||!isAbsolute(root)||/[\r\n\0]/.test(root))throw Error('INVALID_REMOTE_WORKSPACE')
 return root
}
