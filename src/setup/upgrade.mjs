import {cp,lstat,mkdir,readFile,readdir,readlink,rename,rm,writeFile,access} from 'node:fs/promises'
import {dirname,join,resolve,relative,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {realpathSync} from 'node:fs'
import {ServiceManager,userHome,serviceName,xml} from './platform-service.mjs'
import {accountPaths,listAccounts} from '../wechat/accounts.mjs'
import {controlRequest} from '../core/runtime/runtime-control.mjs'
import {npmCommand} from './platform-command.mjs'
import {installConfig} from './install-config.mjs'

const exec=promisify(execFile)
const exists=path=>access(path).then(()=>true,()=>false)
const marker='Managed by wechat-assistant setup v1'

async function sameSourceTree(source,target){
 const [left,right]=await Promise.all([lstat(source),lstat(target)])
 if(left.isDirectory()&&right.isDirectory()){
  const names=async path=>(await readdir(path)).filter(name=>name!=='node_modules').sort()
  const [a,b]=await Promise.all([names(source),names(target)])
  if(a.length!==b.length||a.some((name,index)=>name!==b[index]))return false
  for(const name of a)if(!await sameSourceTree(join(source,name),join(target,name)))return false
  return true
 }
 if(left.isFile()&&right.isFile())return left.size===right.size&&(await readFile(source)).equals(await readFile(target))
 if(left.isSymbolicLink()&&right.isSymbolicLink())return await readlink(source)===await readlink(target)
 return false
}

// Source replacement keeps service configuration, overrides and workspace paths intact.
// Reject another release layout instead of silently upgrading an unused directory.
export async function standardDeployment({target,home=userHome(),platform=process.platform,run=exec}){
 const manager=new ServiceManager({home,root:target,platform,run})
 const accounts=await listAccounts(home),services=[]
 for(const account of accounts){
  let definition,command
  if(platform==='linux'){
   const {stdout}=await run('systemctl',['--user','show',account.service,'--property=FragmentPath','--property=ExecStart'],{timeout:10000})
   const path=stdout.match(/^FragmentPath=(.+)$/m)?.[1]
   if(!path){if(account.id==='default')throw Error('UPGRADE_SERVICE_NOT_INSTALLED');continue}
   definition=await readFile(path,'utf8');command=stdout
  }else if(platform==='darwin'){
   if(!await exists(manager.plist(account.service))){if(account.id==='default')throw Error('UPGRADE_SERVICE_NOT_INSTALLED');continue}
   definition=await readFile(manager.plist(account.service),'utf8');command=definition
   // A loaded service can still point at an earlier release than its plist.
   try{command=(await run('launchctl',['print',manager.domain+'/'+serviceName(account.service)],{timeout:10000})).stdout}catch{}
  }else if(platform==='win32'){
   const inspector=new ServiceManager({home,root:fileURLToPath(new URL('../../',import.meta.url)),platform,run})
   const details=JSON.parse((await inspector.windows('inspect',account.service)).stdout)
   if(!details.exists){if(account.id==='default')throw Error('UPGRADE_SERVICE_NOT_INSTALLED');continue}
   definition=details.description;command=details.arguments
  }else throw Error('UNSUPPORTED_PLATFORM')
  const entry=join(target,platform==='win32'?'src/setup/service-entry.mjs':'src/wechat/bot.mjs')
  if(!definition.includes(marker)||!(command.includes(entry)||platform==='darwin'&&command.includes(xml(entry))))throw Error('UPGRADE_CUSTOM_DEPLOYMENT')
  const status=await manager.status(account.service)
  services.push({...account,...status})
 }
 return {
  services,
  status:account=>controlRequest(account.socket,'GET','/status'),
  control:(account,action,lease)=>controlRequest(account.socket,'POST','/'+action,{lease}),
  async stop(account){
   const current=await manager.status(account.service)
   await manager.stop(account.service)
   // launchctl can unregister a job before its process has finished shutting down.
   if(current.pid){
    for(let n=0;n<100;n++){
     try{process.kill(current.pid,0)}catch(error){if(error.code==='ESRCH')return;throw error}
     await delay(100)
    }
    throw Error('UPGRADE_STOP_UNCONFIRMED')
   }
  },
  async start(account){
   if((await manager.status(account.service)).active)return
   if(platform==='linux')await run('systemctl',['--user','start',account.service],{timeout:30000})
   else if(platform==='darwin'){
    await run('launchctl',['bootstrap',manager.domain,manager.plist(account.service)],{timeout:15000})
    await run('launchctl',['kickstart',manager.domain+'/'+serviceName(account.service)],{timeout:15000})
   }else await manager.windows('start',account.service)
  },
 }
}

export async function upgradeInstallation({source,target,home=userHome(),adapter,prepare,log=console.log,healthAttempts=30,wait=delay}){
 source=resolve(source);target=resolve(target)
 if(source===target||source.startsWith(target+sep)||target.startsWith(source+sep))throw Error('UPGRADE_SOURCE_OVERLAP')
 for(const path of [source,target]){
  const stat=await lstat(path)
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('UPGRADE_SOURCE_INVALID')
  const pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'))
  if(!['weixin-link','wechat-ping-bot'].includes(pkg.name))throw Error('UPGRADE_SOURCE_INVALID')
 }
 if(await exists(join(target,'.git'))||await exists(join(target,'.env')))throw Error('UPGRADE_CUSTOM_SOURCE')
 adapter??=await standardDeployment({target,home})
 const state=accountPaths('default',home).stateDir
 for(const path of [state,installConfig(home).workspace]){
  if(resolve(path)===target||resolve(path).startsWith(target+sep))throw Error('UPGRADE_DATA_INSIDE_SOURCE')
 }
 const lock=join(home,'.local/share/weixin-link/upgrade.lock')
 await mkdir(dirname(lock),{recursive:true,mode:0o700})
 try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')throw Error('UPGRADE_ALREADY_RUNNING');throw e}
 let alreadyInstalled
 try{alreadyInstalled=await sameSourceTree(source,target)}catch(error){await rm(lock,{recursive:true,force:true});throw error}
 if(alreadyInstalled){
  await rm(lock,{recursive:true,force:true})
  log('源码已是目标版本，未备份或重启服务。')
  return {status:'up_to_date'}
 }
 const id=randomUUID(),stage=join(dirname(target),'.weixin-upgrade-'+id),backup=target+'.backup-'+id
 const recovery=join(home,'.local/share/weixin-link/upgrades',id),snapshot=join(recovery,'state')
 const lease=randomUUID(),active=adapter.services.filter(s=>s.active),drained=[],stopped=[]
 let swapped=false,oldMoved=false,saved=false,finished=false
 const journal=async status=>writeFile(join(recovery,'upgrade.json'),JSON.stringify({status,target,backup,stage,snapshot,accounts:active.map(s=>s.id)},null,2)+'\n',{mode:0o600})
 const stateEntries=async()=> (await readdir(state)).filter(name=>name!=='tools')
 const copyState=async(from,to)=>cp(from,to,{recursive:true,filter:async path=>{
  const rel=relative(from,path);if(rel.split(sep)[0]==='tools')return false
  const info=await lstat(path);return !info.isSocket()
 }})
 async function healthy(account){
  for(let n=0;n<healthAttempts;n++){
   try{const result=await adapter.status(account);if(result.ready&&!result.draining)return}catch{}
   await wait(1000)
  }
  throw Error('UPGRADE_HEALTH_CHECK_FAILED')
 }
 try{
  await mkdir(recovery,{recursive:true,mode:0o700})
  if(process.platform==='win32'){
   const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{timeout:10000})
   const sid=stdout.trim();if(!/^S-1-[0-9-]+$/.test(sid))throw Error('UPGRADE_BACKUP_ACL_FAILED')
   await exec('icacls.exe',[recovery,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{timeout:10000})
  }
  await journal('preparing')
  log('准备新版代码和依赖，现有服务继续运行…')
  await cp(source,stage,{recursive:true,filter:path=>!relative(source,path).split(sep).includes('node_modules')})
  if(prepare)await prepare(stage)
  else{
   const npm=npmCommand(['ci']);await exec(npm.binary,npm.args,{cwd:stage,timeout:600000,maxBuffer:4*1024*1024})
   await exec(process.execPath,['--check',join(stage,'src/wechat/bot.mjs')],{timeout:10000})
  }
  log('等待当前任务结束并备份运行数据…')
  for(const account of active){
   const current=await adapter.status(account)
   if(!current.ready)throw Error('UPGRADE_RUNTIME_NOT_READY')
   drained.push(account)
   const result=await adapter.control(account,'drain',lease)
   if(!result.idle)throw Error('UPGRADE_BUSY')
   await adapter.control(account,'seal',lease)
  }
  for(const account of adapter.services){stopped.push(account);await adapter.stop(account)}
  await copyState(state,snapshot);saved=true;await journal('backed_up')
  await rename(target,backup);oldMoved=true
  await rename(stage,target);swapped=true;await journal('switched')
  for(const account of active){await adapter.start(account);await healthy(account)}
  await journal('complete');finished=true
  log('升级完成。旧版本与运行数据备份：'+recovery+'；旧源码：'+backup)
  return {status:'complete',backup,recovery}
 }catch(error){
  if(oldMoved){
   log('升级未通过，正在恢复旧版本和运行数据…')
   try{
    // Never restore databases until every potentially started process is stopped.
    for(const account of adapter.services)await adapter.stop(account)
    if(swapped)await rename(target,join(dirname(target),'.weixin-failed-'+id))
    await rename(backup,target);oldMoved=false
    if(saved){for(const name of await stateEntries())await rm(join(state,name),{recursive:true,force:true});await copyState(snapshot,state)}
    for(const account of active){await adapter.start(account);await healthy(account)}
    await journal('rolled_back');finished=true
   }catch{await journal('rollback_failed');throw Object.assign(Error('UPGRADE_ROLLBACK_FAILED'),{recovery})}
  }else{
   try{
    for(const account of stopped.filter(s=>s.active))await adapter.start(account)
    for(const account of drained)try{await adapter.control(account,'resume',lease)}catch{}
    for(const account of stopped.filter(s=>s.active))await healthy(account)
    await journal('unchanged');finished=true
   }catch{await journal('recovery_failed');throw Object.assign(Error('UPGRADE_ROLLBACK_FAILED'),{recovery})}
  }
  throw error
 }finally{
  await rm(stage,{recursive:true,force:true}).catch(()=>{})
  // Retain the recovery record and lock when automatic rollback cannot be verified.
  if(finished)await rm(lock,{recursive:true,force:true})
 }
}

const errors={
 UPGRADE_CUSTOM_DEPLOYMENT:'检测到自定义服务或其他版本目录。未修改现有部署；请由部署者使用自己的发布流程升级，或先完成标准安装迁移。',
 UPGRADE_CUSTOM_SOURCE:'源码目录包含 Git 工作区或自定义 .env。请使用原部署流程升级；未覆盖本地修改。',
 UPGRADE_BUSY:'当前有任务执行中，未切换版本。请等任务结束后重试。',
 UPGRADE_ALREADY_RUNNING:'已有升级锁。请先确认之前的升级是否完成，并检查 upgrades 下的恢复记录。',
 UPGRADE_ROLLBACK_FAILED:'自动回滚未能确认完成。备份与恢复记录已保留，请检查服务状态后按恢复记录处理。',
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const target=process.argv[2]
 if(!target){console.error('用法：node src/setup/upgrade.mjs 已安装源码目录');process.exitCode=1}
 else try{await upgradeInstallation({source:fileURLToPath(new URL('../../',import.meta.url)),target})}
 catch(error){console.error(errors[error.message]??'升级未完成，请检查服务状态和恢复记录。');console.error('错误代码：'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'UPGRADE_FAILED'));process.exitCode=1}
}
