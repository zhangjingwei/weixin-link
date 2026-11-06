// Compatibility loader only; implementations live in base/, remote/ and core/remote-tasks/.
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join,isAbsolute} from 'node:path'
process.env.WECHAT_REMOTE_WORKSPACE??=fileURLToPath(new URL('.',import.meta.url))
const sourceRoot=process.env.WECHAT_BOT_ROOT??fileURLToPath(new URL('../',import.meta.url))
if(!isAbsolute(sourceRoot)||/[\r\n\0]/.test(sourceRoot))throw Error('INVALID_BOT_ROOT')
export function loadRemoteModule(name){
 if(!/^remote-[a-z-]+$/.test(name))throw Error('INVALID_REMOTE_MODULE')
 const modulePath={
  'remote-controller':'src/core/remote-tasks/remote-controller.mjs',
  'remote-codex':'src/core/remote-tasks/remote-cli.mjs',
  'remote-deploy':'src/setup/remote-deploy.mjs',
  'remote-live-check':'src/tools/remote/remote-live-check.mjs',
  'remote-stop-live-check':'src/tools/remote/remote-stop-live-check.mjs',
  'remote-verify':'src/tools/remote/remote-verify.mjs',
 }[name]
 if(!modulePath)throw Error('INVALID_REMOTE_MODULE')
 return import(pathToFileURL(join(sourceRoot,modulePath)).href)
}
