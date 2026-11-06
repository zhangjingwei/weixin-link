import {maintenanceRun} from './maintenance-run.mjs'
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {assertAccount} from '../wechat/accounts.mjs'
import {bindingIdentity} from '../base/codex/backend-identity.mjs'
import {RemoteStore} from '../core/registry-lock.mjs'
import {CODEX_VERSION} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
const exec=promisify(execFile)
export async function containerSetup(action,accountId,{home=process.env.HOME,send=async()=>{},run=maintenanceRun,signal}={}){
 const originalRun=run;run=(binary,args,options={})=>originalRun(binary,args,{...options,signal})
 const account=await assertAccount(accountId,home),identity=await bindingIdentity(account),base=account.base,id='agent-'+createHash('sha256').update(identity).digest('hex').slice(0,16),root=join(base,'containers',id),container='wechat-codex-'+id
 return new RemoteStore(base).locked('container-bootstrap',async()=>{
  try{const r=JSON.parse((await run('podman',['info','--format','json'],{timeout:10000})).stdout);if(!r.host?.security?.rootless)throw Error('PODMAN_ROOTLESS_REQUIRED');if(r.host.cgroupVersion!=='v2'||!r.host.cgroupControllers?.includes('memory'))throw Error('PODMAN_MEMORY_CONTROLLER_REQUIRED')}catch(error){throw Error(['PODMAN_ROOTLESS_REQUIRED','PODMAN_MEMORY_CONTROLLER_REQUIRED'].includes(error.message)?error.message:'PODMAN_NOT_READY')}
  const registryPath=join(base,'containers.json');let registry={version:1,targets:{}};try{registry=JSON.parse(await readFile(registryPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(action==='container-login'){
   const target=registry.targets[id];if(!target||target.wechatAccountId!==identity)throw Error('CONTAINER_NOT_CREATED')
   return deviceLogin({binary:'podman',prefixArgs:['exec','-i',target.container,target.binary],send,signal})
  }
  if(registry.targets[id]){const target=registry.targets[id];if(target.wechatAccountId!==identity||target.container!==container||target.root!==root)throw Error('CONTAINER_IDENTITY_MISMATCH');await run('systemctl',['--user','start',container+'.service'],{timeout:60000});const inspect=JSON.parse((await run('podman',['inspect',container],{timeout:10000})).stdout);if(!inspect[0]?.State?.Running)throw Error('CONTAINER_NOT_RUNNING');return {status:'already_created',backend:id,running:true}}
  await run('podman',['info'],{timeout:10000})
  for(const name of ['home/codex','workspace','run','build'])await mkdir(join(root,name),{recursive:true,mode:0o700})
  await writeFile(join(root,'build/Containerfile'),`FROM docker.io/library/node:24-bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*\nRUN npm install -g @openai/codex@${CODEX_VERSION}\n`,{mode:0o600})
  const image='localhost/wechat-codex:'+CODEX_VERSION+'-node24'
  await run('podman',['build','--tag',image,'--file',join(root,'build/Containerfile'),join(root,'build')],{timeout:600000,maxBuffer:1024*1024})
  const configPath=join(root,'home/codex/config.toml');let configExists=false;try{await access(configPath);configExists=true}catch{}
  if(!configExists)await writeFile(configPath,'cli_auth_credentials_store = "file"\n[features]\nmemories = true\n[memories]\ngenerate_memories = true\nuse_memories = true\n',{mode:0o600,flag:'wx'})
  const units=join(home,'.config/containers/systemd');await mkdir(units,{recursive:true,mode:0o700});const unitPath=join(units,container+'.container');let existingUnit;try{existingUnit=await readFile(unitPath,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
  if(/[\n\r%\0]/.test(root))throw Error('INVALID_CONTAINER_PATH')
  const text=`# Managed by wechat-assistant setup v1\n[Unit]\nDescription=Isolated Codex agent\n[Container]\nContainerName=${container}\nImage=${image}\nPull=never\nNetwork=slirp4netns:allow_host_loopback=false\nEnvironment=HOME=/agent\nEnvironment=CODEX_HOME=/agent/codex\nWorkingDir=/workspace\nVolume="${root}/home:/agent:rw"\nVolume="${root}/workspace:/workspace:rw"\nVolume="${root}/run:/run/agent:rw"\nPodmanArgs=--userns=keep-id --user=${process.getuid()}:${process.getgid()} --read-only --cap-drop=all --security-opt=no-new-privileges --memory=1536m --memory-swap=1536m --cpus=0.5 --pids-limit=128 --tmpfs=/tmp:rw,nosuid,nodev,size=128m\nExec=/usr/local/bin/codex app-server --listen unix:///run/agent/app-server.sock\n[Service]\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`
  if(existingUnit!==undefined&&existingUnit!==text)throw Error('EXISTING_CONTAINER_UNIT_REQUIRES_REVIEW');if(existingUnit===undefined)await writeFile(unitPath,text,{mode:0o600,flag:'wx'});await run('systemctl',['--user','daemon-reload'],{timeout:15000});await run('systemctl',['--user','start',container+'.service'],{timeout:60000})
  registry.targets[id]={wechatAccountId:identity,container,root,binary:'/usr/local/bin/codex',image};await writeFile(registryPath+'.tmp',JSON.stringify(registry,null,2)+'\n',{mode:0o600});await rename(registryPath+'.tmp',registryPath)
  return {status:'created_not_bound',backend:id,loginRequired:true}
 })
}
export async function containerForAccount(accountId,{home=process.env.HOME}={}){const account=await assertAccount(accountId,home),identity=await bindingIdentity(account),registry=JSON.parse(await readFile(join(account.base,'containers.json'),'utf8'));const id='agent-'+createHash('sha256').update(identity).digest('hex').slice(0,16);if(registry.targets?.[id]?.wechatAccountId!==identity)throw Error('CONTAINER_NOT_CREATED');return {id,account}}
