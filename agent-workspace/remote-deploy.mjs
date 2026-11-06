import {pathToFileURL} from 'node:url'
import {loadRemoteModule} from './remote-loader.mjs'
export const {deploy,windowsDeployment,runDeploymentCli}=await loadRemoteModule('remote-deploy')
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runDeploymentCli()
