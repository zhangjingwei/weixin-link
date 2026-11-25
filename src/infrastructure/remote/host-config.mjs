import {resolveRemoteWorkspace} from './workspace.mjs'
import {readFileSync,lstatSync} from 'node:fs'
import {isAbsolute,join} from 'node:path'
import {parseConfig,MAX_CONFIG_BYTES} from '../config/config-schema.mjs'
function loadRemoteHosts(path=process.env.WECHAT_REMOTE_HOSTS??join(resolveRemoteWorkspace(),'remote-hosts.json')){
 if(typeof path!=='string'||!isAbsolute(path)||/[\r\n\0]/.test(path))throw Error('INVALID_REMOTE_HOSTS_PATH')
 let text
 try{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CONFIG_BYTES)throw Error('REMOTE_HOSTS_CONFIG_UNREADABLE');text=readFileSync(path,'utf8')}catch(error){if(error.code==='ENOENT'&&!process.env.WECHAT_REMOTE_HOSTS)return {};throw Error('REMOTE_HOSTS_CONFIG_UNREADABLE')}
 try{return parseConfig('remote-hosts',text).hosts}catch{throw Error('INVALID_REMOTE_HOSTS_CONFIG')}
}
function remoteConfigStatus(){
 try{return {valid:true,hosts:loadRemoteHosts()}}catch(error){return {valid:false,hosts:{},error:error.message}}
}
export function configuredHost(host){const state=remoteConfigStatus();if(!state.valid)throw Error(state.error);if(!Object.hasOwn(state.hosts,host))throw Error('UNKNOWN_HOST');return state.hosts[host]}
