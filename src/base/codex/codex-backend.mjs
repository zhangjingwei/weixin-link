import {homedir as platformHome} from 'node:os'
import {readFileSync} from 'node:fs'
import {bindingIdentity} from './backend-identity.mjs'
import {readFile,writeFile,mkdir,realpath,stat,copyFile,chmod,lstat} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute,basename,extname} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {PodmanRpc} from './podman-rpc.mjs'
const exec=promisify(execFile),MAX=50*1024*1024
const within=(root,path)=>{const r=relative(resolve(root),resolve(path));return r===''||r!=='..'&&!/^\.\.[\\/]/.test(r)&&!isAbsolute(r)}
export function containerTarget(id,home=(process.env.HOME||platformHome())){
 if(!['pilot-a','pilot-b'].includes(id)){
  if(!/^agent-[a-f0-9]{16}$/.test(id))throw Error('UNKNOWN_CODEX_BACKEND')
  let t;try{t=JSON.parse(readFileSync(join(home,'.local/share/wechat-ping-bot/containers.json'),'utf8')).targets?.[id]}catch{throw Error('UNKNOWN_CODEX_BACKEND')}
  const root=join(home,'.local/share/wechat-ping-bot/containers',id);if(!t||t.root!==root||t.container!=='wechat-codex-'+id||t.binary!=='/usr/local/bin/codex')throw Error('INVALID_CONTAINER_REGISTRY')
  return {id,kind:'podman',container:t.container,binary:t.binary,socket:'/run/agent/app-server.sock',cwd:'/workspace',root,workspace:join(root,'workspace'),home:join(root,'home'),memoryMode:'native',wechatAccountId:t.wechatAccountId}
 }
 const agent=id.at(-1),root=join(home,'work/wechat-assistant/.private/podman-pilot',agent)
 return {id,kind:'podman',container:'codex-pilot-'+agent,binary:'/opt/codex-release/bin/codex',socket:'/run/agent/app-server.sock',cwd:'/workspace',root,workspace:join(root,'workspace'),home:join(root,'home'),memoryMode:'native'}
}
export async function loadBackend(account,hostCwd,override,{listAccounts}={}){
 let config=override;try{if(config===undefined)config=JSON.parse(await readFile(join(account.stateDir,'codex-backend.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(!config||config.id==='host')return {id:'host',kind:'host',cwd:hostCwd,stateDir:account.stateDir,memoryMode:'native',instructions:'长期记忆统一使用当前 Codex 原生记忆，不生成微信自定义记忆块。'}
 if(config.version!==1)throw Error('INVALID_CODEX_BACKEND_CONFIG')
 if(override===undefined){if(!config.wechatAccountId)throw Error('WECHAT_BINDING_IDENTITY_REQUIRED');if(config.wechatAccountId!==await bindingIdentity(account))throw Error('WECHAT_BINDING_IDENTITY_MISMATCH')}
 if(override===undefined){if(typeof listAccounts!=='function')throw Error('ACCOUNT_REGISTRY_REQUIRED');for(const other of await listAccounts()){if(other.id===account.id)continue;let binding;try{binding=JSON.parse(await readFile(join(other.stateDir,'codex-backend.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(binding?.id===config.id)throw Error('CONTAINER_ALREADY_BOUND_TO_OTHER_ACCOUNT')}}
 const target=containerTarget(config.id);if(target.wechatAccountId&&target.wechatAccountId!==await bindingIdentity(account))throw Error('WECHAT_BINDING_IDENTITY_MISMATCH');const backend={...target,stateDir:join(account.stateDir,'backends',target.id)}
 // Native memory is scoped to one explicitly bound owner and exclusive container.
 backend.instructions='运行环境：独立 Podman 容器，工作目录 /workspace。仅能操作本容器挂载的文件。附件已复制到 /workspace/inputs；交付产物请写入 /workspace/outputs 并给出该目录的绝对路径链接。宿主机脚本、SSH 密钥与远程适配器不在本容器内，不能假定可用。长期记忆使用当前 Codex 的原生记忆，不生成微信自定义记忆块。'
 backend.rpcFactory=options=>new PodmanRpc({...options,backend})
 backend.remoteControl=async()=>({stop_confirmed:true,tasks:[]})
 backend.prepareInput=async(value,{signal}={})=>{
  if(typeof value==='string')return value
  const paths=[...new Set([...(value.attachments??[]).map(a=>a.path),...(value.images??[]),...(value.audios??[])].filter(Boolean))]
  if(!paths.length)return value
  const dir=join(backend.workspace,'inputs',randomUUID());await mkdir(dir,{recursive:true,mode:0o700});const mapping=new Map()
  for(const original of paths){signal?.throwIfAborted();const actual=await realpath(original),allowed=await realpath(join(account.stateDir,'attachments'));if(!within(allowed,actual))throw Error('INPUT_OWNER_PATH_REFUSED');const s=await stat(actual);if(!s.isFile()||s.size>MAX)throw Error('INPUT_FILE_SIZE_LIMIT');const name=createHash('sha256').update(actual).digest('hex').slice(0,20)+extname(actual);const dst=join(dir,name);await copyFile(actual,dst);await chmod(dst,0o600);mapping.set(original,'/workspace/'+relative(backend.workspace,dst))}
  let text=value.text;for(const [original,path]of [...mapping].sort((a,b)=>b[0].length-a[0].length))text=text.replaceAll(original,path)
  text+='\n容器附件说明：上列附件路径已映射到当前容器；宿主 media-tools.mjs 不可用。只按已提供的 processing 范围说明识别内容，若需进一步解析先检查容器内工具，不声称已解析未处理内容。'
  return {...value,text,images:(value.images??[]).map(p=>mapping.get(p)),audios:(value.audios??[]).map(p=>mapping.get(p)),attachments:(value.attachments??[]).map(a=>({...a,path:mapping.get(a.path)??a.path}))}
 }
 backend.fileReader=async path=>{
  let root,part
  if(path.startsWith('/workspace/outputs/')){root=join(backend.workspace,'outputs');part=path.slice('/workspace/outputs/'.length)}
  else if(path.startsWith('/agent/codex/generated_images/')){root=join(backend.home,'codex/generated_images');part=path.slice('/agent/codex/generated_images/'.length)}
  else throw Error('EXPORT_PATH_REFUSED')
  if(part.split('/').some(p=>!p||p==='..'||p.startsWith('.'))||/^(credentials|secrets?|tokens?|private[-_]key)/i.test(basename(part)))throw Error('EXPORT_PATH_REFUSED')
  const candidate=join(root,part),actual=await realpath(candidate),actualRoot=await realpath(root);if((await lstat(root)).isSymbolicLink())throw Error('EXPORT_PATH_REFUSED');let checked=root;for(const segment of part.split('/')){checked=join(checked,segment);if((await lstat(checked)).isSymbolicLink())throw Error('EXPORT_PATH_REFUSED')}if(!within(actualRoot,actual))throw Error('EXPORT_PATH_REFUSED');const s=await stat(actual);if(!s.isFile()||s.size<1||s.size>MAX)throw Error('FILE_SIZE_LIMIT');const data=await readFile(actual);if(data.length>MAX)throw Error('FILE_SIZE_LIMIT');return data
 }
 backend.stopBackground=async session=>{
  const itemIds=new Set(session.items?.keys()??[])
  const list=async()=>{let cursor;const rows=[];const seen=new Set();do{const page=await session.rpc.request('thread/backgroundTerminals/list',{threadId:session.threadId,limit:100,...(cursor?{cursor}:{})});rows.push(...page.data);cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('TERMINAL_PAGINATION_INCOMPLETE');seen.add(cursor)}while(cursor);return rows}
  const owned=(await list()).filter(t=>itemIds.has(t.itemId));for(const terminal of owned)await session.rpc.request('thread/backgroundTerminals/terminate',{threadId:session.threadId,processId:terminal.processId})
  for(let n=0;n<20;n++){if(!(await list()).some(t=>itemIds.has(t.itemId)))return;await new Promise(r=>setTimeout(r,100))}throw Error('CONTAINER_COMMAND_STOP_UNCONFIRMED')
 }
 backend.preflight=async owners=>{
  if(owners.length!==1)throw Error('NATIVE_BACKEND_REQUIRES_ONE_AUTHORIZED_OWNER')
  const {stdout}=await exec('podman',['inspect',backend.container],{maxBuffer:1024*1024});const info=JSON.parse(stdout)[0]
  if(!info.State?.Running)throw Error('CODEX_CONTAINER_NOT_RUNNING')
  if(info.Config?.User!==`${process.getuid()}:${process.getgid()}`||!info.HostConfig.ReadonlyRootfs||info.HostConfig.Privileged||info.HostConfig.Memory!==1610612736||!info.HostConfig.SecurityOpt?.includes('no-new-privileges'))throw Error('CODEX_CONTAINER_ISOLATION_MISMATCH')
  if(info.Mounts?.some(m=>!(m.Destination==='/tmp'&&m.Type==='tmpfs')&&!['/workspace','/agent','/run/agent','/opt/codex-release','/etc/ssl/certs/ca-certificates.crt'].includes(m.Destination)))throw Error('CODEX_CONTAINER_EXTRA_MOUNT_REFUSED')
  for(const [destination,source]of [['/workspace',backend.workspace],['/agent',backend.home]])if(!info.Mounts?.some(m=>m.Destination===destination&&resolve(m.Source)===resolve(source)))throw Error('CODEX_CONTAINER_MOUNT_MISMATCH')
  await exec('podman',['exec',backend.container,backend.binary,'login','status'],{maxBuffer:8192})
 }
 return backend
}
