import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {tmpdir} from 'node:os'
import {realpath,mkdtemp,readFile,rm} from 'node:fs/promises'
import {join,isAbsolute,relative,sep} from 'node:path'
import {projectRoot} from '../../config/install-config.mjs'

const exec=promisify(execFile)
export async function inspectSystemCodex(binary,{env=process.env,run=exec,root=projectRoot}={}){
 const path=await realpath(binary)
 const local=relative(await realpath(root),path)
 if(!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep))throw Object.assign(Error('CODEX_PROJECT_BINARY'),{code:'CODEX_PROJECT_BINARY'})
 const options={env,timeout:10000,maxBuffer:131072,windowsHide:true}
 const version=await run(binary,['--version'],options)
 if(!/^codex(?:-cli)?\s+\d+\.\d+\.\d+/i.test(version.stdout.trim()))throw Error('CODEX_CLI_VERSION_UNSUPPORTED')
 const dir=await mkdtemp(join(tmpdir(),'zerolink-codex-schema-'))
 try{
  await run(binary,['app-server','generate-json-schema','--experimental','--out',dir],{
   ...options,cwd:dir,env:{...env,CODEX_HOME:dir}
  })
  const schema=JSON.parse(await readFile(join(dir,'ClientRequest.json'),'utf8'))
  const methods=new Set(schema.oneOf.flatMap(item=>item.properties?.method?.enum??[]))
  const required=['initialize','skills/extraRoots/set','thread/start','thread/resume','thread/read','thread/memoryMode/set',
   'turn/start','turn/interrupt','thread/turns/list','thread/queue/add','thread/queue/delete','thread/queue/list']
  if(!required.every(method=>methods.has(method)))throw Error('CODEX_APP_SERVER_UNSUPPORTED')
 }finally{await rm(dir,{recursive:true,force:true})}
}
