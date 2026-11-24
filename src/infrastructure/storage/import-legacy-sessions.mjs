import {copyFile,link,lstat,mkdir,readdir,unlink,writeFile} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'

async function directory(path,{create=false}={}){
 if(create)await mkdir(path,{recursive:true,mode:0o700})
 const info=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
 if(info&&!info.isDirectory())throw Error('CODEX_SESSION_DIRECTORY_INVALID')
 return !!info
}

// Publish only complete transcripts. The personal store may already be in use by the CLI.
async function importDirectory(source,target,existingRollouts){
 if(!await directory(source))return
 await directory(target,{create:true})
 for(const entry of await readdir(source,{withFileTypes:true})){
  const from=join(source,entry.name),to=join(target,entry.name)
  if(entry.isDirectory()){await importDirectory(from,to,existingRollouts);continue}
  if(!entry.isFile()||!/^rollout-.+\.jsonl$/.test(entry.name)||existingRollouts.has(entry.name))continue
  const existing=await lstat(to).catch(error=>{if(error.code!=='ENOENT')throw error})
  if(existing?.isFile())continue
  const temporary=to+'.'+randomUUID()+'.tmp'
  try{
   await copyFile(from,temporary)
   try{await link(temporary,to);existingRollouts.add(entry.name)}catch(error){if(error.code!=='EEXIST'||!(await lstat(to)).isFile())throw error}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
 }
}

export async function importLegacySessions(stateDir,personalHome){
 const previous=join(stateDir,'codex-home')
 if(resolve(previous)===resolve(personalHome)||!await directory(previous))return
 const key=createHash('sha256').update(resolve(personalHome)).digest('hex').slice(0,16)
 const marker=join(stateDir,'personal-sessions-imported-'+key)
 if(await lstat(marker).catch(error=>{if(error.code!=='ENOENT')throw error}))return
 if(resolve(personalHome).startsWith(resolve(previous)+sep))throw Error('CODEX_SESSION_DIRECTORY_INVALID')
 const directories=['sessions','archived_sessions'],existingRollouts=new Set()
 for(const name of directories){
  const target=join(personalHome,name)
  if(await directory(target)){
   for(const entry of await readdir(target,{recursive:true,withFileTypes:true})){
    if(entry.isFile()&&entry.name.startsWith('rollout-'))existingRollouts.add(entry.name)
   }
  }
 }
 for(const name of directories)await importDirectory(join(previous,name),join(personalHome,name),existingRollouts)
 await writeFile(marker,'1\n',{mode:0o600})
}
