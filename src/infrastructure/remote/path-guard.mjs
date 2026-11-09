import {configuredHost} from './host-config.mjs'
import {win32,posix} from 'node:path'
export function projectPath(host,value,hosts){
 const config=hosts?hosts[host]:configuredHost(host)
 if(!config)throw Error('UNKNOWN_HOST')
 const {isAbsolute,resolve,relative,sep}=config.platform==='win32'?win32:posix
 if(!config||typeof value!=='string'||!isAbsolute(value)||/[\0\r\n]/.test(value)||value.split(/[\\/]/).includes('..'))throw Error('INVALID_PROJECT')
 const path=resolve(value),rel=relative(config.root,path)
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||rel.split(sep).some(p=>p.startsWith('.')))throw Error('PROJECT_OUTSIDE_HOST_ROOT')
 return path
}
export function exportPath(cwd,value){const {resolve,relative,isAbsolute,basename,sep}=win32.isAbsolute(cwd)&&!posix.isAbsolute(cwd)?win32:posix;const path=resolve(value),rel=relative(cwd,path);if(!isAbsolute(value)||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||rel.split(sep).some(p=>p.startsWith('.'))||/^(?:credentials|secrets?|tokens?|private[-_]key)/i.test(basename(path)))throw Error('EXPORT_PATH_REFUSED');return path}
