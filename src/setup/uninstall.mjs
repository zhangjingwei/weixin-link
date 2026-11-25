import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {readFile,readdir,unlink,lstat} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {ServiceManager,xml} from './platform-service.mjs'

const exec=promisify(execFile)
const source=resolve(fileURLToPath(new URL('../..',import.meta.url)))
const exists=async path=>{try{return await lstat(path)}catch(error){if(error.code==='ENOENT')return null;throw error}}
const managed=async(path,root)=>{
 const file=await exists(path)
 if(!file)return false
 if(!file.isFile()||file.isSymbolicLink())throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
 const content=await readFile(path,'utf8')
 if(!content.includes('Managed by wechat-assistant setup v1')||!content.includes(root)&&!content.includes(xml(root)))throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
 return true
}

async function launchAgentLoaded(run,target){
 try{await run('launchctl',['print',target],{timeout:10000});return true}
 catch(error){if(Number(error.code)===113)return false;throw Error('SERVICE_STATUS_UNCONFIRMED')}
}

async function waitForLaunchAgentUnload(run,target,wait){
 for(let attempt=0;attempt<40;attempt++){
  if(!await launchAgentLoaded(run,target))return true
  if(attempt<39)await wait(250)
 }
 return false
}

export async function uninstallInstallation({home=process.env.HOME||homedir(),root=source,platform=process.platform,run=exec,manager=new ServiceManager({home,root,platform,run}),wait=delay}={}){
 const packageFile=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
 if(packageFile.name!=='weixin-link')throw Error('INSTALLATION_NOT_FOUND')
 const finish=async servicesRemoved=>({servicesRemoved,accountDataPreserved:true,workspacePreserved:true})
 const unit='wechat-ping-bot.service'
 if(platform==='linux'){
  const directory=join(home,'.config/systemd/user')
  const path=join(directory,unit)
  const present=await managed(path,root)
  if(!present){
   const result=await run('systemctl',['--user','list-units','--all','--plain','--no-legend','wechat-ping-bot*.service','wechat-pair-*.service']).catch(()=>({stdout:''}))
   if(result.stdout.trim())throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
   return finish(false)
  }
  const pairUnit='wechat-pair-default.service'
  await run('systemctl',['--user','stop',pairUnit]).catch(()=>{})
  const pairStatus=await run('systemctl',['--user','is-active',pairUnit]).catch(()=>({stdout:'inactive'}))
  if(/^(active|activating)\b/.test(pairStatus.stdout.trim()))throw Error('SERVICE_STOP_UNCONFIRMED')
  {
   const load=await run('systemctl',['--user','show',unit,'--property=LoadState']).catch(()=>({stdout:'LoadState=not-found'}))
   if(!load.stdout.includes('LoadState=not-found')){
    await run('systemctl',['--user','disable','--now',unit])
    const result=await run('systemctl',['--user','is-active',unit]).catch(()=>({stdout:'inactive'}))
    if(/^(active|activating)\b/.test(result.stdout.trim()))throw Error('SERVICE_STOP_UNCONFIRMED')
   }
  }
  await unlink(path)
  await run('systemctl',['--user','daemon-reload'])
 }else if(platform==='darwin'){
  const directory=join(home,'Library/LaunchAgents')
  const files=(await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error})).filter(name=>/^com\.wechat-assistant\.(wechat-ping-bot|wechat-pair-default)\.plist$/.test(name))
  if(!files.length){
   const result=await run('launchctl',['list']).catch(()=>({stdout:''}))
   if(/com\.wechat-assistant\.(wechat-ping-bot|wechat-pair-)/.test(result.stdout))throw Error('UNINSTALL_SERVICE_REQUIRES_REVIEW')
   return finish(false)
  }
  for(const name of files){
   const path=join(directory,name)
   if(!await managed(path,root))continue
   const target=manager.domain+'/'+name.slice(0,-6)
   try{await run('launchctl',['bootout',target],{timeout:30000})}
   catch{
    if(await launchAgentLoaded(run,target))await run('launchctl',['bootout',manager.domain,path],{timeout:30000}).catch(()=>{})
   }
   if(!await waitForLaunchAgentUnload(run,target,wait))throw Error('SERVICE_STOP_UNCONFIRMED')
   await unlink(path)
  }
 }else if(platform==='win32'){
  await manager.windows('remove','wechat-pair-default.service')
  await manager.windows('remove',unit)
 }else throw Error('UNSUPPORTED_PLATFORM')
 return finish(true)
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await uninstallInstallation();console.log('程序服务已卸载。账号数据和工作区已保留。')}catch(error){console.error('卸载未完成：'+(error.code||error.message));process.exitCode=1}
}
