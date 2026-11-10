import {integrations,integrationByConfig} from '../integrations/registry.mjs'
import {homedir} from 'node:os'
import {join,dirname,posix,win32} from 'node:path'
import {access,stat,readFile} from 'node:fs/promises'
import {constants as fsConstants} from 'node:fs'
import {createPublicKey} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {ConfigError,validateConfig,parseConfig} from './config-schema.mjs'
import {atomicConfigWrite,readPrivateFile,digest} from './config-files.mjs'
import {installConfig,projectRoot,findCodex} from './install-config.mjs'
import {updateWorkspaceGuidance} from './workspace-guidance.mjs'
const exec=promisify(execFile),quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'"
const currentHome=()=>process.env.HOME||homedir()
export function configPath(kind,{home=currentHome(),workspace,env=process.env}={}){
 if(kind==='installation')return join(home,'.local/share/wechat-ping-bot/installation.json')
 const integration=integrationByConfig(kind)
 if(integration&&kind!=='remote-hosts')return integration.configPath({home,workspace,env})
 if(kind==='backup'){
  const path=join(home,'.config/wechat-assistant/backup.json')
  if(env.WECHAT_BACKUP_CONFIG&&env.WECHAT_BACKUP_CONFIG!==path)throw new ConfigError('CONFIG_CUSTOM_PATH_UNMANAGED')
  return path
 }
 if(kind==='remote-hosts'){
  const path=join(workspace??env.WECHAT_REMOTE_WORKSPACE??installConfig(home).workspace,'remote-hosts.json')
  if(env.WECHAT_REMOTE_HOSTS&&env.WECHAT_REMOTE_HOSTS!==path)throw new ConfigError('CONFIG_CUSTOM_PATH_UNMANAGED')
  return path
 }
 throw new ConfigError('CONFIG_UNKNOWN_KIND')
}
export async function configStatus(options={}){
 const result={}
 for(const kind of [...new Set(['installation','backup','remote-hosts',...integrations.map(item=>item.manifest.configKind)])]){
  try{const text=await readPrivateFile(configPath(kind,options));if(text===null){result[kind]={configured:false};continue}const config=parseConfig(kind,text);result[kind]={configured:true,valid:true,version:config.version}}
  catch(error){result[kind]={configured:true,valid:false,error:error.code??'CONFIG_UNREADABLE'}}
 }
 return result
}
async function probeConfiguration(kind,config,{home=currentHome(),env=process.env}={}){
 try{
  const integration=integrationByConfig(kind)
  if(integration&&kind!=='remote-hosts'){
   await integration.health(config)
  }else if(kind==='backup'){
   if(process.platform!=='linux')throw new ConfigError('CONFIG_PLATFORM_NOT_SUPPORTED','backup')
   const key=createPublicKey(await readFile(join(home,'.config/wechat-assistant/backup-public.pem')))
   if(key.asymmetricKeyType!=='rsa')throw Error()
   await exec('python3',['-c','import cryptography,fcntl'],{timeout:6000,maxBuffer:65536})
   const command='test -d '+quote(config.remoteDirectory)+' && test -w '+quote(config.remoteDirectory)+' && test -r .config/wechat-backup-key/private.pem'
   await exec('ssh',['-F',env.WECHAT_SSH_CONFIG??join(home,'.ssh/wechat_hosts_config'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=6',config.host,command],{timeout:12000,maxBuffer:65536})
  }else if(kind==='installation'){
   if(!(await stat(config.workspace)).isDirectory())throw Error()
   await access(config.workspace,fsConstants.W_OK)
   if(config.codexBinary){const {stdout}=await exec(config.codexBinary,['--version'],{timeout:10000,maxBuffer:65536});if(!/^codex(?:-cli)?\s+\d+\.\d+/i.test(stdout.trim()))throw Error()}
  }
 }catch(error){if(error instanceof ConfigError)throw error;throw new ConfigError('CONFIG_CONNECTION_CHECK_FAILED',kind)}
}
export async function runtimeEndpoints(home=currentHome()){
 const {listAccounts}=await import('../infrastructure/accounts/account-store.mjs'),endpoints=[]
 for(const account of await listAccounts(home)){
  try{await access(process.platform==='win32'?join(account.stateDir,'control-token'):account.socket);endpoints.push(account.socket)}catch(error){if(error.code!=='ENOENT')throw new ConfigError('CONFIG_RUNTIME_UNAVAILABLE')}
 }
 return endpoints
}
async function checkRemoteTransition(previous,config,options){
 const path=join(dirname(configPath('remote-hosts',options)),'remote-sessions.json'),text=await readPrivateFile(path)
 if(text===null)return []
 let tasks;try{tasks=Object.values(JSON.parse(text)).filter(t=>t?.kind==='official-remote-task'&&!t.stop_confirmed)}catch{throw new ConfigError('CONFIG_REMOTE_STATE_INVALID')}
 let old;try{if(previous)old=parseConfig('remote-hosts',previous)}catch{}
 for(const task of tasks){
  const next=Object.hasOwn(config.hosts,task.host)?config.hosts[task.host]:null
  if(!next)throw new ConfigError('CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION')
  if(!old?.hosts[task.host])throw new ConfigError('CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION')
  if(['platform','binary','root','transport','port'].some(k=>old.hosts[task.host][k]!==next[k]))throw new ConfigError('CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION')
  const paths=next.platform==='win32'?win32:posix,relative=typeof task.cwd==='string'?paths.relative(next.root,task.cwd):'..'
  if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw new ConfigError('CONFIG_REMOTE_TASKS_REQUIRE_RECONCILIATION')
 }
 return tasks
}
export async function configure(kind,input,{home=currentHome(),workspace,env=process.env,verify=probeConfiguration,restoring=false}={}){
 const config=validateConfig(kind,input),options={home,workspace,env},path=configPath(kind,options),previous=await readPrivateFile(path),expected=digest(previous)
 if(kind==='installation'&&previous&&!restoring){
  let old
  try{old=parseConfig(kind,previous)}catch{
   let raw;try{raw=JSON.parse(previous)}catch{throw new ConfigError('CONFIG_INSTALLATION_UNREADABLE')}
   old=validateConfig('installation',{workspace:raw?.workspace})
  }
  if(old.workspace!==config.workspace)throw new ConfigError('CONFIG_WORKSPACE_MIGRATION_REQUIRED')
 }
 if(kind==='installation'&&(await runtimeEndpoints(home)).length)throw new ConfigError('CONFIG_INSTALLATION_REQUIRES_STOP')
 if(kind!=='remote-hosts')await verify(kind,config,options)
 if(kind==='installation'&&(await runtimeEndpoints(home)).length)throw new ConfigError('CONFIG_INSTALLATION_REQUIRES_STOP')
 const write=()=>atomicConfigWrite(path,JSON.stringify(config,null,2)+'\n',{expected,backup:!restoring})
 let result
 // Remote operations and configuration share this lock. Do not drain the caller's chat turn.
 if(kind==='remote-hosts'){const {RemoteStore}=await import('../infrastructure/storage/registry-lock.mjs');result=await new RemoteStore(dirname(path)).locked('host-config',async()=>{await checkRemoteTransition(previous,config,options);return write()})}
 else result=await write()
 let guidance
 if(kind==='installation'){
  try{guidance=await updateWorkspaceGuidance({workspace:config.workspace,root:projectRoot,codexBinary:config.codexBinary??findCodex(home)})}catch(error){guidance={updated:false,error:error.code??'GUIDANCE_UPDATE_FAILED'}}
 }
 return {kind,version:config.version,verified:kind!=='remote-hosts',written:true,...result,effective:kind==='installation'?'next_service_start':'next_operation',...(guidance?{guidance}:{}),restartRequired:kind==='installation'}
}
export async function restoreConfiguration(kind,options={}){
 const path=configPath(kind,options),previous=await readPrivateFile(path+'.previous');if(previous===null)throw new ConfigError('CONFIG_NO_PREVIOUS_VERSION')
 return configure(kind,parseConfig(kind,previous),{...options,restoring:true})
}
export {readConfigStdin} from '../infrastructure/config/config-input.mjs'
