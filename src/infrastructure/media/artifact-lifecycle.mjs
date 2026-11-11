import {mkdir,readdir,lstat,readFile,writeFile,unlink,rm,realpath} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,dirname} from 'node:path'
import {createHash} from 'node:crypto'
const WEEK=7*24*60*60*1000
const ownerKey=user=>createHash('sha256').update(user).digest('hex').slice(0,24)
export const deliveryDirectory=(stateDir,user)=>join(stateDir,'deliverables',ownerKey(user))
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel)}
export async function prepareDeliveryDirectory(stateDir,user){
 const path=deliveryDirectory(stateDir,user)
 await mkdir(path,{recursive:true,mode:0o700})
 if((await lstat(join(stateDir,'deliverables'))).isSymbolicLink()||(await lstat(path)).isSymbolicLink())throw Error('EXPORT_PATH_REFUSED')
 return path
}
export async function completeArtifacts(store,user,packet,now=Date.now()){
 if(packet.errors?.length||!packet.attachments.length||packet.attachments.some(a=>a.status!=='accepted'))return
 const declaredRoot=join(store.stateDir,'outgoing',ownerKey(user))
 if((await lstat(declaredRoot)).isSymbolicLink())throw Error('ARTIFACT_OWNER_MISMATCH')
 const root=await realpath(declaredRoot)
 // Snapshot location, never source links, establishes ownership of the expiry marker.
 const declared=dirname(resolve(packet.attachments[0].path))
 const dir=await realpath(declared)
 if(!inside(root,dir)||packet.attachments.some(a=>dirname(resolve(a.path))!==declared))throw Error('ARTIFACT_OWNER_MISMATCH')
 if((await lstat(dir)).isSymbolicLink())throw Error('ARTIFACT_OWNER_MISMATCH')
 await writeFile(join(dir,'.delivered'),String(now),{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error})
 const sourceRoot=await realpath(deliveryDirectory(store.stateDir,user)).catch(()=>null)
 for(const item of packet.attachments){
  if(!sourceRoot||!item.sourcePath||!inside(sourceRoot,resolve(item.sourcePath)))continue
  // Source may have changed since packaging. Never remove a replacement or a symlink.
  try{
   const info=await lstat(item.sourcePath)
   const actual=await realpath(item.sourcePath)
   if(!info.isFile()||info.isSymbolicLink()||!inside(sourceRoot,actual))continue
   const data=await readFile(item.sourcePath)
   if(createHash('sha256').update(data).digest('hex')===item.sourceHash)await unlink(item.sourcePath)
  }catch(error){if(error.code!=='ENOENT')throw error}
 }
}
export async function pruneArtifacts(store,user,now=Date.now()){
 const root=join(store.stateDir,'outgoing',ownerKey(user))
 let entries;try{if((await lstat(root)).isSymbolicLink())throw Error('ARTIFACT_OWNER_MISMATCH');entries=await readdir(root,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}
 for(const entry of entries){
  if(!entry.isDirectory()||! /^[a-f\d-]{36}$/.test(entry.name))continue
  const dir=join(root,entry.name)
  let completed;try{const marker=join(dir,'.delivered');if(!(await lstat(marker)).isFile()||(await lstat(marker)).isSymbolicLink())continue;completed=Number(await readFile(marker,'utf8'))}catch(error){if(error.code==='ENOENT')continue;throw error}
  if(Number.isFinite(completed)&&completed>0&&now-completed>=WEEK)await rm(dir,{recursive:true,force:true})
 }
}
export async function assertArtifactFresh(path,now=Date.now()){
 try{const completed=Number(await readFile(join(dirname(path),'.delivered'),'utf8'));if(Number.isFinite(completed)&&completed>0&&now-completed>=WEEK)throw Error('ARTIFACT_EXPIRED')}
 catch(error){if(error.code!=='ENOENT')throw error}
}
