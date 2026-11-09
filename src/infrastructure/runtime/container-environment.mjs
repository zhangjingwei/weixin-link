import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {assertAccount,bindingIdentity} from '../accounts/account-store.mjs'
import {RemoteStore} from '../storage/registry-lock.mjs'

function targetFor(account,identity,spec){
 if(!spec||typeof spec.targetId!=='function'||typeof spec.containerName!=='function'||!Array.isArray(spec.environment??[]))throw Error('INVALID_CONTAINER_SPEC')
 const id=spec.targetId(identity),root=join(account.base,'containers',id),container=spec.containerName(id)
 if(!/^[a-z][a-z0-9-]{0,79}$/.test(id)||typeof container!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(container)||/["\n\r%\0]/.test(root)||!spec.kind||!spec.binary||!spec.image||!spec.exec||!spec.containerfile||[spec.kind,spec.binary,spec.image,spec.exec,spec.description??'',...(spec.environment??[])].some(value=>typeof value!=='string'||/[\n\r%\0]/.test(value)))throw Error('INVALID_CONTAINER_PATH')
 return {id,root,container}
}
function matching(target,{root,container},identity,spec){
 return target?.wechatAccountId===identity&&target.root===root&&target.container===container&&target.binary===spec.binary&&(!target.agentKind||target.agentKind===spec.kind)
}
async function registryAt(path){
 try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return {version:1,targets:{}};throw error}
}
async function checkPodman(run){
 try{
  const {host}=JSON.parse((await run('podman',['info','--format','json'],{timeout:10000})).stdout)
  if(!host?.security?.rootless)throw Error('PODMAN_ROOTLESS_REQUIRED')
  if(host.cgroupVersion!=='v2'||!host.cgroupControllers?.includes('memory'))throw Error('PODMAN_MEMORY_CONTROLLER_REQUIRED')
 }catch(error){throw Error(['PODMAN_ROOTLESS_REQUIRED','PODMAN_MEMORY_CONTROLLER_REQUIRED'].includes(error.message)?error.message:'PODMAN_NOT_READY')}
}
function containerUnit(spec,{container,root}){
 const env=(spec.environment??[]).map(value=>'Environment='+value+'\n').join('')
 return `# Managed by wechat-assistant setup v1\n[Unit]\nDescription=${spec.description??'Isolated agent'}\n[Container]\nContainerName=${container}\nImage=${spec.image}\nPull=never\nNetwork=slirp4netns:allow_host_loopback=false\nEnvironment=HOME=/agent\n${env}WorkingDir=/workspace\nVolume="${root}/home:/agent:rw"\nVolume="${root}/workspace:/workspace:rw"\nVolume="${root}/run:/run/agent:rw"\nPodmanArgs=--userns=keep-id --user=${process.getuid()}:${process.getgid()} --read-only --cap-drop=all --security-opt=no-new-privileges --memory=1536m --memory-swap=1536m --cpus=0.5 --pids-limit=128 --tmpfs=/tmp:rw,nosuid,nodev,size=128m\nExec=${spec.exec}\n[Service]\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`
}

/** Provision an account-owned isolation boundary from an agent runtime spec. */
export async function provisionContainer(action,accountId,{home=process.env.HOME,send=async()=>{},run,signal,spec}={}){
 if(typeof run!=='function')throw Error('CONTAINER_RUNNER_REQUIRED')
 const originalRun=run;run=(binary,args,options={})=>originalRun(binary,args,{...options,signal})
 const account=await assertAccount(accountId,home),identity=await bindingIdentity(account),target=targetFor(account,identity,spec),{id,root,container}=target
 return new RemoteStore(account.base).locked('container-bootstrap',async()=>{
  await checkPodman(run)
  const registryPath=join(account.base,'containers.json'),registry=await registryAt(registryPath),existing=registry.targets[id]
  if(action==='container-login'){
   if(!matching(existing,target,identity,spec))throw Error('CONTAINER_NOT_CREATED')
   if(typeof spec.login!=='function')throw Error('CONTAINER_LOGIN_UNAVAILABLE')
   return spec.login(existing,{send,signal})
  }
  if(existing){
   if(!matching(existing,target,identity,spec))throw Error('CONTAINER_IDENTITY_MISMATCH')
   await run('systemctl',['--user','start',container+'.service'],{timeout:60000})
   const inspect=JSON.parse((await run('podman',['inspect',container],{timeout:10000})).stdout)
   if(!inspect[0]?.State?.Running)throw Error('CONTAINER_NOT_RUNNING')
   return {status:'already_created',backend:id,running:true}
  }
  await run('podman',['info'],{timeout:10000})
  for(const name of ['home','workspace','run','build'])await mkdir(join(root,name),{recursive:true,mode:0o700})
  await writeFile(join(root,'build/Containerfile'),spec.containerfile,{mode:0o600})
  await run('podman',['build','--tag',spec.image,'--file',join(root,'build/Containerfile'),join(root,'build')],{timeout:600000,maxBuffer:1024*1024})
  await spec.prepare?.(root)
  const units=join(home,'.config/containers/systemd');await mkdir(units,{recursive:true,mode:0o700})
  const unitPath=join(units,container+'.container'),unit=containerUnit(spec,target)
  let existingUnit;try{existingUnit=await readFile(unitPath,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
  if(existingUnit!==undefined&&existingUnit!==unit)throw Error('EXISTING_CONTAINER_UNIT_REQUIRES_REVIEW')
  if(existingUnit===undefined)await writeFile(unitPath,unit,{mode:0o600,flag:'wx'})
  await run('systemctl',['--user','daemon-reload'],{timeout:15000})
  await run('systemctl',['--user','start',container+'.service'],{timeout:60000})
  registry.targets[id]={wechatAccountId:identity,container,root,binary:spec.binary,image:spec.image,...(spec.kind==='codex'?{}:{agentKind:spec.kind})}
  await writeFile(registryPath+'.tmp',JSON.stringify(registry,null,2)+'\n',{mode:0o600});await rename(registryPath+'.tmp',registryPath)
  return {status:'created_not_bound',backend:id,loginRequired:typeof spec.login==='function'}
 })
}
export async function containerForAccount(accountId,{home=process.env.HOME,spec}={}){
 const account=await assertAccount(accountId,home),identity=await bindingIdentity(account),target=targetFor(account,identity,spec)
 const registry=await registryAt(join(account.base,'containers.json'))
 if(!matching(registry.targets[target.id],target,identity,spec))throw Error('CONTAINER_NOT_CREATED')
 return {id:target.id,account}
}
