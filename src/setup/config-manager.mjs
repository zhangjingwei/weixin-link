import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {integrations,integrationByConfig} from '../integrations/registry.mjs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {access,stat} from 'node:fs/promises'
import {constants as fsConstants} from 'node:fs'
import {ConfigError,validateConfig,parseConfig} from './config-schema.mjs'
import {atomicConfigWrite,readPrivateFile,digest} from './config-files.mjs'
import {installConfig,projectRoot} from './install-config.mjs'
import {updateWorkspaceGuidance} from './workspace-guidance.mjs'
const currentHome=()=>process.env.HOME||homedir()
export function configPath(kind,{home=currentHome(),workspace,env=process.env}={}){
 if(kind==='desktop')return join(accountPaths(env.WECHAT_ACCOUNT??'default',home).stateDir,'desktop-handoff.json')
 if(kind==='installation')return join(home,'.local/share/wechat-ping-bot/installation.json')
 const integration=integrationByConfig(kind)
 if(integration&&kind!=='remote-hosts')return integration.configPath({home,workspace,env})
 if(kind==='remote-hosts'){
  const path=join(workspace??env.WECHAT_REMOTE_WORKSPACE??installConfig(home).workspace,'remote-hosts.json')
  if(env.WECHAT_REMOTE_HOSTS&&env.WECHAT_REMOTE_HOSTS!==path)throw new ConfigError('CONFIG_CUSTOM_PATH_UNMANAGED')
  return path
 }
 throw new ConfigError('CONFIG_UNKNOWN_KIND')
}
export async function configStatus(options={}){
 const result={}
 for(const kind of [...new Set(['installation','remote-hosts','desktop',...integrations.map(item=>item.manifest.configKind)])]){
  try{const text=await readPrivateFile(configPath(kind,options));if(text===null){result[kind]={configured:false};continue}const config=parseConfig(kind,text);result[kind]={configured:true,valid:true,version:config.version}}
  catch(error){result[kind]={configured:true,valid:false,error:error.code??'CONFIG_UNREADABLE'}}
 }
 return result
}
async function probeConfiguration(kind,config){
 try{
  const integration=integrationByConfig(kind)
  if(integration&&kind!=='remote-hosts'){
   await integration.health(config)
  }else if(kind==='desktop'){
   if(config.enabled&&process.platform!=='darwin')throw new ConfigError('CONFIG_PLATFORM_NOT_SUPPORTED','desktop')
  }else if(kind==='installation'){
   if(!(await stat(config.workspace)).isDirectory())throw Error()
   await access(config.workspace,fsConstants.W_OK)
  }
 }catch(error){if(error instanceof ConfigError)throw error;throw new ConfigError('CONFIG_CONNECTION_CHECK_FAILED',kind)}
}
async function runtimeEndpoints(home=currentHome()){
 const {accountPaths}=await import('../infrastructure/accounts/account-store.mjs')
 const account=accountPaths('default',home)
 try{await access(process.platform==='win32'?join(account.stateDir,'control-token'):account.socket);return [account.socket]}catch(error){if(error.code==='ENOENT')return [];throw new ConfigError('CONFIG_RUNTIME_UNAVAILABLE')}
}
export async function configure(kind,input,{home=currentHome(),workspace,env=process.env,verify=probeConfiguration,restoring=false}={}){
 const config=validateConfig(kind,input),options={home,workspace,env},path=configPath(kind,options),previous=await readPrivateFile(path),expected=digest(previous)
 if(kind==='installation'&&previous&&!restoring){
  const old=parseConfig(kind,previous)
  if(old.workspace!==config.workspace)throw new ConfigError('CONFIG_WORKSPACE_MIGRATION_REQUIRED')
 }
 if(kind==='installation'&&(await runtimeEndpoints(home)).length)throw new ConfigError('CONFIG_INSTALLATION_REQUIRES_STOP')
 if(kind!=='remote-hosts')await verify(kind,config,options)
 if(kind==='installation'&&(await runtimeEndpoints(home)).length)throw new ConfigError('CONFIG_INSTALLATION_REQUIRES_STOP')
 const write=()=>atomicConfigWrite(path,JSON.stringify(config,null,2)+'\n',{expected,backup:!restoring})
 let result
 result=await write()
 let guidance
 if(kind==='installation'){
  try{guidance=await updateWorkspaceGuidance({workspace:config.workspace,root:projectRoot})}catch(error){guidance={updated:false,error:error.code??'GUIDANCE_UPDATE_FAILED'}}
 }
 return {kind,version:config.version,verified:kind!=='remote-hosts',written:true,...result,effective:kind==='installation'?'next_service_start':'next_operation',...(guidance?{guidance}:{}),restartRequired:kind==='installation'}
}
export async function restoreConfiguration(kind,options={}){
 const path=configPath(kind,options),previous=await readPrivateFile(path+'.previous');if(previous===null)throw new ConfigError('CONFIG_NO_PREVIOUS_VERSION')
 return configure(kind,parseConfig(kind,previous),{...options,restoring:true})
}
export {readConfigStdin} from '../infrastructure/config/config-input.mjs'
