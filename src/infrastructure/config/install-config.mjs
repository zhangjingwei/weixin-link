import {parseConfig,MAX_CONFIG_BYTES} from './config-schema.mjs'
import {homedir as platformHome} from 'node:os'
import {fileURLToPath} from 'node:url'
import {readFileSync,lstatSync} from 'node:fs'
import {join,isAbsolute} from 'node:path'
export const projectRoot=fileURLToPath(new URL('../../../',import.meta.url))
export function installConfig(home=(process.env.HOME||platformHome()),{root=projectRoot}={}){let c={};try{const path=join(home,'.local/share/wechat-ping-bot/installation.json'),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CONFIG_BYTES)throw Error('INSTALL_CONFIG_UNREADABLE');c=parseConfig('installation',readFileSync(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('INSTALL_CONFIG_UNREADABLE')}
 if(c.workspace!==undefined&&(!isAbsolute(c.workspace)||/[\r\n\0]/.test(c.workspace)))throw Error('INVALID_INSTALL_CONFIG')
 return {workspace:c.workspace??join(home,'work/wechat-assistant')}
}
