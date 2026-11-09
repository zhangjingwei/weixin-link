import {resolveRemoteWorkspace} from './workspace.mjs'
import {readFileSync,lstatSync} from 'node:fs'
import {homedir} from 'node:os'
import {isAbsolute,join} from 'node:path'
import {parseConfig,validateHostConfig,MAX_CONFIG_BYTES} from '../config/config-schema.mjs'
export const sshConfig=process.env.WECHAT_SSH_CONFIG??join(homedir(),'.ssh/wechat_hosts_config')
export {validateHostConfig}
export function loadRemoteHosts(path=process.env.WECHAT_REMOTE_HOSTS??join(resolveRemoteWorkspace(),'remote-hosts.json')){
 if(typeof path!=='string'||!isAbsolute(path)||/[\r\n\0]/.test(path))throw Error('INVALID_REMOTE_HOSTS_PATH')
 let text
 try{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CONFIG_BYTES)throw Error('REMOTE_HOSTS_CONFIG_UNREADABLE');text=readFileSync(path,'utf8')}catch(error){if(error.code==='ENOENT'&&!process.env.WECHAT_REMOTE_HOSTS)return {};throw Error('REMOTE_HOSTS_CONFIG_UNREADABLE')}
 try{return parseConfig('remote-hosts',text).hosts}catch{throw Error('INVALID_REMOTE_HOSTS_CONFIG')}
}
export function remoteConfigStatus(){
 try{return {valid:true,hosts:loadRemoteHosts()}}catch(error){return {valid:false,hosts:{},error:error.message}}
}
export function configuredHost(host){const state=remoteConfigStatus();if(!state.valid)throw Error(state.error);if(!Object.hasOwn(state.hosts,host))throw Error('UNKNOWN_HOST');return state.hosts[host]}
export function hostSnapshot({path,hosts}={}){
 const loaded=hosts??loadRemoteHosts(path)
 const snapshot=Object.create(null)
 for(const [name,config] of Object.entries(loaded)){validateHostConfig(name,config);snapshot[name]=Object.freeze(structuredClone(config))}
 return Object.freeze(snapshot)
}
// Validate on access: invalid optional configuration cannot prevent local bot startup.
// Every newly created transport stores its own immutable host snapshot.
export const HOSTS=new Proxy({}, {
 get:(_,key)=>{const hosts=remoteConfigStatus().hosts;return Object.hasOwn(hosts,key)?hosts[key]:undefined},
 ownKeys:()=>Reflect.ownKeys(remoteConfigStatus().hosts),
 getOwnPropertyDescriptor:(_,key)=>{const hosts=remoteConfigStatus().hosts;return Object.hasOwn(hosts,key)?{value:hosts[key],enumerable:true,configurable:true}:undefined},
 set:()=>false,
})
export const shellQuote=value=>"'"+value.replaceAll("'", "'\"'\"'")+"'"
