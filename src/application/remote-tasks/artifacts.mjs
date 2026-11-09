import {exportPath} from './paths.mjs'
import {HOSTS} from '../../remote/remote-config.mjs'
import {win32,posix} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
const hostPath=host=>HOSTS[host]?.platform==='win32'?win32:posix
export async function fetch(context,input){const target=await context.task(input.task),path=exportPath(target.cwd,input.path);return context.usingTask(target,async rpc=>{
  const {relative,join,sep,basename}=hostPath(target.host);const rel=relative(target.cwd,path);let current=target.cwd
  for(const part of ['',...rel.split(sep)]){if(part)current=join(current,part);const info=await rpc.call('fs/getMetadata',{path:current});if(info.isSymlink)throw Error('EXPORT_SYMLINK_REFUSED')}
  const result=await rpc.call('fs/readFile',{path},60000);if(result.dataBase64.length>70*1024*1024)throw Error('ARTIFACT_TOO_LARGE');const bytes=Buffer.from(result.dataBase64,'base64');if(!bytes.length||bytes.length>50*1024*1024)throw Error('ARTIFACT_TOO_LARGE')
  const dir=join(context.root,'outputs','remote',input.task);await mkdir(dir,{recursive:true,mode:0o700});const dest=join(dir,hash(bytes).slice(0,16)+'-'+basename(path));await writeFile(dest,bytes,{mode:0o600});return {task:input.task,host:target.host,path:dest,bytes:bytes.length,sha256:hash(bytes)}
 })}
