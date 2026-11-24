import {mkdir,readFile,writeFile,lstat,realpath,copyFile,chmod,readdir,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,relative,isAbsolute,basename} from 'node:path'
const hash=value=>createHash('sha256').update(value).digest('hex')
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)}
const WEEK=7*86400000

// Copy only the current prepared receipt into a private per-target snapshot.
// Source receipts and project files are never deleted by this lifecycle.
export function attachmentHandoffs(stateDir,jobs,{now=Date.now}={}){
 const root=join(stateDir,'attachment-handoffs')
 async function cleanup(){
  let dirs;try{dirs=await readdir(root,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}
  for(const dir of dirs){
   if(!dir.isDirectory()||! /^[a-f0-9]{64}$/.test(dir.name))continue
   const path=join(root,dir.name),manifest=join(path,'manifest.json');let record
   try{if((await lstat(manifest)).isSymbolicLink())continue;record=JSON.parse(await readFile(manifest,'utf8'))}catch{continue}
   const consumers=jobs.pending().filter(job=>job.input?.attachmentHandoff?.id===dir.name)
   if(consumers.length)continue
   // Only a positively completed consumer set starts the retention clock.
   const rows=jobs.db.prepare("SELECT state,outcome FROM jobs WHERE json_extract(input,'$.attachmentHandoff.id')=?").all(dir.name)
   if(!rows.length||rows.some(job=>job.state!=='done'||job.outcome!=='completed'))continue
   if(!record.completedAt){record.completedAt=now();await writeFile(manifest,JSON.stringify(record),{mode:0o600})}
   else if(now()-record.completedAt>WEEK)await rm(path,{recursive:true,force:true})
  }
 }
 return {cleanup,async prepare({sourceKey,targetKey,ingressId,input}){
  if(! /^[a-f0-9]{64}$/.test(ingressId))throw Error('ATTACHMENT_HANDOFF_INVALID')
  await mkdir(root,{recursive:true,mode:0o700});if((await lstat(root)).isSymbolicLink())throw Error('ATTACHMENT_HANDOFF_UNSAFE')
  await cleanup()
  let stored=0;const entries=await readdir(root,{recursive:true,withFileTypes:true});if(entries.length>20000)throw Error('ATTACHMENT_HANDOFF_LIMIT')
  for(const entry of entries)if(entry.isFile())stored+=(await lstat(join(entry.parentPath,entry.name))).size
  if(stored>1024*1024*1024-100*1024*1024)throw Error('ATTACHMENT_HANDOFF_LIMIT')
  const id=hash(JSON.stringify([sourceKey,targetKey,ingressId])),dir=join(root,id);await mkdir(dir,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error});if((await lstat(dir)).isSymbolicLink())throw Error('ATTACHMENT_HANDOFF_UNSAFE')
  const allowed=await realpath(join(stateDir,'attachments',hash(sourceKey).slice(0,24))),paths=[...new Set([...(input.attachments??[]).map(a=>a.path),...(input.images??[]),...(input.audios??[])])],mapping=new Map();let bytes=0
  for(let i=0;i<paths.length;i++){
   const source=paths[i],stat=await lstat(source),resolved=await realpath(source)
   if(!stat.isFile()||stat.isSymbolicLink()||!inside(allowed,resolved)||(bytes+=stat.size)>100*1024*1024)throw Error('ATTACHMENT_HANDOFF_UNSAFE')
   const expected=input.attachments?.find(a=>a.path===source)?.sha256
   const target=join(dir,`${i+1}-${basename(source)}`),digest=hash(await readFile(source))
   if(expected&&expected!==digest)throw Error('ATTACHMENT_HANDOFF_CHANGED')
   try{await copyFile(source,target,1);await chmod(target,0o600)}catch(error){if(error.code!=='EEXIST')throw error;if((await lstat(target)).isSymbolicLink()||(await lstat(target)).nlink>1||hash(await readFile(target))!==digest)throw Error('ATTACHMENT_HANDOFF_CHANGED')}
   if(hash(await readFile(target))!==digest)throw Error('ATTACHMENT_HANDOFF_CHANGED')
   mapping.set(source,target)
  }
  function replace(value){if(typeof value==='string'){for(const [source,target]of [...mapping].sort((a,b)=>b[0].length-a[0].length))value=value.replaceAll(source,target);return value}if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)]));return value}
  const record={version:1,id,createdAt:now(),sourceKey:hash(sourceKey),targetKey:hash(targetKey),retentionDaysAfterConfirmedCompletion:7}
  try{await writeFile(join(dir,'manifest.json'),JSON.stringify(record),{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST')throw error}
  return {...replace(input),attachmentHandoff:{id,retentionDaysAfterConfirmedCompletion:7}}
 }}
}
