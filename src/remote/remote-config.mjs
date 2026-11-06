import {remoteWorkspace} from './remote-paths.mjs'
import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,posix,win32} from 'node:path'
export const sshConfig=process.env.WECHAT_SSH_CONFIG??join(homedir(),'.ssh/wechat_hosts_config')
export function loadRemoteHosts(path=process.env.WECHAT_REMOTE_HOSTS??join(remoteWorkspace,'remote-hosts.json')){
 let hosts
 try{hosts=JSON.parse(readFileSync(path,'utf8'))}catch(error){if(error.code==='ENOENT'&&!process.env.WECHAT_REMOTE_HOSTS)return {};throw Error('REMOTE_HOSTS_CONFIG_UNREADABLE')}
 if(!hosts||typeof hosts!=='object'||Array.isArray(hosts))throw Error('INVALID_REMOTE_HOSTS_CONFIG')
 for(const [host,c] of Object.entries(hosts)){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host)||!c||!['posix','win32'].includes(c.platform)||!['daemon-proxy','ssh-websocket'].includes(c.transport))throw Error('INVALID_REMOTE_HOSTS_CONFIG')
  const path=c.platform==='win32'?win32:posix
  if(![c.binary,c.root].every(s=>typeof s==='string'&&path.isAbsolute(s)&&!/[\r\n\0]/.test(s)))throw Error('INVALID_REMOTE_HOSTS_CONFIG')
  if(c.platform==='win32'&&c.transport!=='ssh-websocket'||c.transport==='ssh-websocket'&&(!Number.isInteger(c.port)||c.port<1024||c.port>65535))throw Error('INVALID_REMOTE_HOSTS_CONFIG')
 }
 return hosts
}
export const HOSTS=Object.freeze(loadRemoteHosts())
export const shellQuote=value=>"'"+value.replaceAll("'", "'\"'\"'")+"'"
