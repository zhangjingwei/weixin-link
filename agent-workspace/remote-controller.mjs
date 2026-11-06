// Compatibility export; no remote execution implementation is stored here.
import {loadRemoteModule} from './remote-loader.mjs'
export const {RemoteController,projectPath,exportPath}=await loadRemoteModule('remote-controller')
