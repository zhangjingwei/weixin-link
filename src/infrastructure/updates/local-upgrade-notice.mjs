import {watchFile,unwatchFile} from 'node:fs'
import {join} from 'node:path'

export const localUpgradeMarker='.weixin-link-local-update.json'

// The upgraded service is already polling when the installer confirms health.
export function watchLocalUpgrade(sourceDir,onReady){
 const path=join(sourceDir,localUpgradeMarker)
 const changed=current=>{if(current.nlink)onReady()}
 watchFile(path,{persistent:false,interval:1000},changed)
 return ()=>unwatchFile(path,changed)
}
