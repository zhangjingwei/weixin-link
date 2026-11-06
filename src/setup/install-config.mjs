import {homedir as platformHome} from 'node:os'
import {fileURLToPath} from 'node:url'
import {readFileSync,existsSync,readdirSync} from 'node:fs'
import {join,isAbsolute,delimiter,dirname} from 'node:path'
export const projectRoot=fileURLToPath(new URL('../../',import.meta.url))
export function installConfig(home=(process.env.HOME||platformHome())){let c={};try{c=JSON.parse(readFileSync(join(home,'.local/share/wechat-ping-bot/installation.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('INSTALL_CONFIG_UNREADABLE')}
 for(const k of ['workspace','codexBinary'])if(c[k]!==undefined&&(!isAbsolute(c[k])||/[\r\n\0]/.test(c[k])))throw Error('INVALID_INSTALL_CONFIG')
 return {workspace:c.workspace??join(home,'work/wechat-assistant'),codexBinary:c.codexBinary??findCodex(home)}
}
export function findCodex(home=(process.env.HOME||platformHome())){
 const roots=[join(home,'.local/bin'),join(home,'.local/share/wechat-ping-bot/tools/codex/bin'),...(process.env.PATH??'').split(delimiter).filter(Boolean)]
 if(process.platform!=='win32')return roots.map(p=>join(p,'codex')).find(existsSync)??join(home,'.local/bin/codex')
 // npm shims cannot be launched with spawn(shell:false); find the bundled native executable.
 const native=roots.map(p=>join(p,'codex.exe')).find(existsSync);if(native)return native
 const packages=[join(home,'.local/share/wechat-ping-bot/tools/codex/node_modules/@openai'),...roots.flatMap(p=>[join(p,'node_modules/@openai'),join(dirname(p),'node_modules/@openai')])]
 const search=(dir,depth)=>{if(depth<0)return;let rows;try{rows=readdirSync(dir,{withFileTypes:true})}catch{return}for(const e of rows){const p=join(dir,e.name);if(e.isFile()&&e.name==='codex.exe')return p;if(e.isDirectory()){const found=search(p,depth-1);if(found)return found}}}
 for(const dir of packages){const found=search(dir,6);if(found)return found}
 return join(home,'.local/bin/codex.exe')
}
