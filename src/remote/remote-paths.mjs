import {fileURLToPath} from 'node:url'
import {isAbsolute} from 'node:path'
import {installConfig} from '../setup/install-config.mjs'
export const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url))
export const remoteWorkspace=process.env.WECHAT_REMOTE_WORKSPACE??installConfig().workspace
if(!isAbsolute(remoteWorkspace)||/[\r\n\0]/.test(remoteWorkspace))throw Error('INVALID_REMOTE_WORKSPACE')
