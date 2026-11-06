import {createHash} from 'node:crypto'
import {join} from 'node:path'
export function controlEndpoint(stateDir,platform=process.platform){return platform==='win32'?'\\\\.\\pipe\\wechat-assistant-'+createHash('sha256').update(stateDir).digest('hex').slice(0,32):join(stateDir,'runtime.sock')}
export const isPipe=path=>path.startsWith('\\\\.\\pipe\\')
