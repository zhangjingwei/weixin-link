import {maintenanceRun} from './maintenance-run.mjs'
import {codexContainerSpec} from './container-specs/codex.mjs'
import {provisionContainer,containerForAccount as registeredContainer} from '../infrastructure/runtime/container-environment.mjs'

// Preserve the existing Codex setup entry point and registry identity.
export function containerSetup(action,accountId,options={}){
 return provisionContainer(action,accountId,{...options,run:options.run??maintenanceRun,spec:options.spec??codexContainerSpec})
}
export function containerForAccount(accountId,options={}){
 return registeredContainer(accountId,{...options,spec:options.spec??codexContainerSpec})
}
