import {parseConfig,MAX_CONFIG_BYTES} from './config-schema.mjs'
import {homedir as platformHome} from 'node:os'
import {fileURLToPath} from 'node:url'
import {readFileSync,lstatSync} from 'node:fs'
import {join,isAbsolute} from 'node:path'
export const projectRoot=fileURLToPath(new URL('../../../',import.meta.url))
export function installConfig(home=(process.env.HOME||platformHome()),{root=projectRoot}={}){let c={};try{const path=join(home,'.local/share/wechat-ping-bot/installation.json'),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CONFIG_BYTES)throw Error('INSTALL_CONFIG_UNREADABLE');c=parseConfig('installation',readFileSync(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('INSTALL_CONFIG_UNREADABLE')}
 if(c.workspace!==undefined&&(!isAbsolute(c.workspace)||/[\r\n\0]/.test(c.workspace)))throw Error('INVALID_INSTALL_CONFIG')
 return {workspace:c.workspace??join(home,'work/wechat-assistant'),codexBinary:findCodex(home,{root})}
}
export function findCodex(_home=(process.env.HOME||platformHome()),{root=projectRoot,platform=process.platform,arch=process.arch}={}){
 const targets={linux:{x64:'x86_64-unknown-linux-musl',arm64:'aarch64-unknown-linux-musl'},darwin:{x64:'x86_64-apple-darwin',arm64:'aarch64-apple-darwin'},win32:{x64:'x86_64-pc-windows-msvc',arm64:'aarch64-pc-windows-msvc'}}
 const target=targets[platform]?.[arch]
 if(!target)throw Error('CODEX_BUNDLED_PLATFORM_UNSUPPORTED')
 return join(root,'node_modules','@openai',`codex-${platform}-${arch}`,'vendor',target,'bin',platform==='win32'?'codex.exe':'codex')
}
