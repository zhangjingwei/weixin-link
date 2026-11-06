// Compatibility loader only; implementation and tests live in src/remote and tests/remote.
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join,isAbsolute} from 'node:path'
process.env.WECHAT_REMOTE_WORKSPACE??=fileURLToPath(new URL('.',import.meta.url))
const sourceRoot=process.env.WECHAT_BOT_ROOT??fileURLToPath(new URL('../',import.meta.url))
if(!isAbsolute(sourceRoot)||/[\r\n\0]/.test(sourceRoot))throw Error('INVALID_BOT_ROOT')
export function loadRemoteModule(name){
 if(!/^remote-[a-z-]+$/.test(name))throw Error('INVALID_REMOTE_MODULE')
 return import(pathToFileURL(join(sourceRoot,'src/remote',name+'.mjs')).href)
}
