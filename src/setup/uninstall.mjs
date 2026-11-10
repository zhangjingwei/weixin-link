import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {readFile,readdir,unlink,lstat} from 'node:fs/promises'
import {ServiceManager,xml} from './platform-service.mjs'

const exec=promisify(execFile)
const source=resolve(fileURLToPath(new URL('../..',import.meta.url)))
const exists=async path=>{try{return await lstat(path)}catch(error){if(error.code==='ENOENT')return null;throw error}}
const accounts=async home=>{
 const path=join(home,'.local/share/wechat-ping-bot/accounts')
 const names=await readdir(path).catch(error=>{if(error.code==='ENOENT')return [];throw error})
 return ['default',...names.filter(name=>/^[a-z][a-z0-9-]{0,31}$/.test(name))]
}
const managed=async(path,root)=>{
 const file=await exists(path)
 if(!file)return false
 if(!file.isFile()||file.isSymbolicLink())throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
 const content=await readFile(path,'utf8')
 if(!content.includes('Managed by wechat-assistant setup v1')||!content.includes(root)&&!content.includes(xml(root)))throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
 return true
}

export async function uninstallInstallation({home=process.env.HOME||homedir(),root=source,platform=process.platform,run=exec,manager=new ServiceManager({home,root,platform,run})}={}){
 const packageFile=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
 if(!['weixin-link','wechat-ping-bot'].includes(packageFile.name))throw Error('INSTALLATION_NOT_FOUND')
 const ids=await accounts(home)
 const units=ids.map(id=>id==='default'?'wechat-ping-bot.service':`wechat-ping-bot@${id}.service`)
 if(platform==='linux'){
  const directory=join(home,'.config/systemd/user')
  const files=['wechat-ping-bot.service','wechat-ping-bot@.service'].map(name=>join(directory,name))
  const present=await Promise.all(files.map(path=>managed(path,root)))
  if(!present.some(Boolean)){
   const result=await run('systemctl',['--user','list-units','--all','--plain','--no-legend','wechat-ping-bot*.service','wechat-pair-*.service']).catch(()=>({stdout:''}))
   if(result.stdout.trim())throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
   return {servicesRemoved:false,accountDataPreserved:true,workspacePreserved:true}
  }
  for(const id of ids){
   const unit=`wechat-pair-${id}.service`
   await run('systemctl',['--user','stop',unit]).catch(()=>{})
   const result=await run('systemctl',['--user','is-active',unit]).catch(()=>({stdout:'inactive'}))
   if(/^(active|activating)\b/.test(result.stdout.trim()))throw Error('SERVICE_STOP_UNCONFIRMED')
  }
  for(const unit of units){
   if(unit==='wechat-ping-bot.service'?!present[0]:!present[1])continue
   const load=await run('systemctl',['--user','show',unit,'--property=LoadState']).catch(()=>({stdout:'LoadState=not-found'}))
   if(load.stdout.includes('LoadState=not-found'))continue
   await run('systemctl',['--user','disable','--now',unit])
   const result=await run('systemctl',['--user','is-active',unit]).catch(()=>({stdout:'inactive'}))
   if(/^(active|activating)\b/.test(result.stdout.trim()))throw Error('SERVICE_STOP_UNCONFIRMED')
  }
  for(let n=0;n<files.length;n++)if(present[n])await unlink(files[n])
  await run('systemctl',['--user','daemon-reload'])
 }else if(platform==='darwin'){
  const directory=join(home,'Library/LaunchAgents')
  const files=(await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error})).filter(name=>/^com\.wechat-assistant\.(wechat-ping-bot(?:\.[a-z][a-z0-9-]{0,31})?|wechat-pair-[a-z][a-z0-9-]{0,31})\.plist$/.test(name))
  if(!files.length){
   const result=await run('launchctl',['list']).catch(()=>({stdout:''}))
   if(/com\.wechat-assistant\.(wechat-ping-bot|wechat-pair-)/.test(result.stdout))throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
   return {servicesRemoved:false,accountDataPreserved:true,workspacePreserved:true}
  }
  for(const name of files){
   const path=join(directory,name)
   if(!await managed(path,root))continue
   const target=manager.domain+'/'+name.slice(0,-6)
   await run('launchctl',['bootout',target]).catch(()=>{})
   const status=await run('launchctl',['print',target]).then(()=>true,()=>false)
   if(status)throw Error('SERVICE_STOP_UNCONFIRMED')
   await unlink(path)
  }
 }else if(platform==='win32'){
  for(const id of ids)await manager.windows('remove',`wechat-pair-${id}.service`)
  for(const unit of units)await manager.windows('remove',unit)
 }else throw Error('UNSUPPORTED_PLATFORM')
 return {servicesRemoved:true,accountDataPreserved:true,workspacePreserved:true}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await uninstallInstallation();console.log('程序服务已卸载。账号数据和工作区已保留。')}catch(error){console.error('卸载未完成：'+(error.code||error.message));process.exitCode=1}
}
