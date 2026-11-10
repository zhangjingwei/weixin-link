import {join} from 'node:path'
import manifest from './manifest.json' with {type:'json'}
import {SshOperations} from '../../application/remote-tasks/ssh-operations.mjs'

export default {
 manifest,
 guidanceUrl:new URL('./guidance.md',import.meta.url),
 async configPath({home,workspace,env=process.env}){
  const {installConfig}=await import('../../infrastructure/config/install-config.mjs')
  return env.WECHAT_REMOTE_HOSTS??join(workspace??env.WECHAT_REMOTE_WORKSPACE??installConfig(home).workspace,'remote-hosts.json')
 },
 async health(config){
  const hosts=Object.keys(config.hosts)
  if(!hosts.length)throw Error('REMOTE_HOSTS_REQUIRED')
  await new SshOperations({hosts:config.hosts}).runRequest({action:'inspect',host:hosts[0],project:config.hosts[hosts[0]].root})
 },
 async invoke(config,request,{scope}){
  if(typeof scope!=='string'||!scope||scope.length>200)throw Error('INTEGRATION_ARGUMENTS_INVALID')
  return new SshOperations({hosts:config.hosts}).runRequest(request)
 },
}
