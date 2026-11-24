import {mkdir,lstat,readFile,writeFile,rename,rm,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {accountCodexHome} from '../infrastructure/accounts/codex-home.mjs'
import {accountPaths,assertAccount} from '../infrastructure/accounts/account-store.mjs'
const sourceRoot=fileURLToPath(new URL('../..',import.meta.url)),files=['SKILL.md','agents/openai.yaml'],marker='.zerolink-managed.json'
const skillName='managing-zerolink',legacyName='zerolink-manage'
const hash=value=>createHash('sha256').update(value).digest('hex')
const stat=path=>lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error})
async function owned(path){
 const info=await stat(path);if(!info)return null
 if(!info.isDirectory()||info.isSymbolicLink())return false
 try{
  const meta=JSON.parse(await readFile(join(path,marker),'utf8'))
  if(meta.owner!=='zerolink-management'||meta.version!==1)return false
  const entries=await readdir(path,{recursive:true})
  if(entries.some(name=>![marker,'agents',...files].includes(name.replaceAll('\\','/'))))return false
  for(const file of [marker,...files]){const info=await lstat(join(path,file));if(!info.isFile()||info.isSymbolicLink())return false}
  for(const file of files)if(hash(await readFile(join(path,file)))!==meta.hashes?.[file])return false
  return true
 }catch{return false}
}
async function removeOwned(path){
 const managed=await owned(path)
 if(managed)await rm(path,{recursive:true})
 return {removed:!!managed,userFilesPreserved:managed===false}
}
export async function detachManagementSkill({accountId='default',home,codexHome=accountCodexHome(accountId,home)}={}){
 const directory=join(codexHome,'skills'),parent=await stat(directory)
 if(!parent||!parent.isDirectory()||parent.isSymbolicLink())return {removed:false,userFilesPreserved:!!parent}
 const current=await removeOwned(join(directory,skillName)),legacy=await removeOwned(join(directory,legacyName))
 return {removed:current.removed||legacy.removed,userFilesPreserved:current.userFilesPreserved||legacy.userFilesPreserved}
}
export async function managementPlugin({action='ensure',accountId='default',home,root=sourceRoot,codexHome=accountCodexHome(accountId,home),stateDir=accountPaths(accountId,home).stateDir}={}){
 if(!['ensure','install','remove','status'].includes(action))throw Error('MANAGEMENT_PLUGIN_INVALID_ACTION')
 const setting=join(stateDir,'management-plugin.json'),source=join(root,'plugins/zerolink-management/skills',skillName),directory=join(codexHome,'skills'),path=join(directory,skillName),legacyPath=join(directory,legacyName)
 let enabled=true
 try{const value=JSON.parse(await readFile(setting,'utf8'));if(typeof value.enabled!=='boolean')throw Error('MANAGEMENT_PLUGIN_INVALID_CONFIG');enabled=value.enabled}catch(error){if(error.code!=='ENOENT')throw error}
 if(action==='status')return {enabled,installed:await owned(path)===true||await owned(legacyPath)===true}
 await mkdir(stateDir,{recursive:true,mode:0o700})
 const {default:lockfile}=await import('proper-lockfile')
 const release=await lockfile.lock(stateDir,{lockfilePath:join(stateDir,'.management-plugin.lock'),stale:30000,retries:0})
 try{
  if(action==='install'||action==='remove'){
   enabled=action==='install';const tmp=setting+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({enabled}),{mode:0o600});await rename(tmp,setting)
  }
  if(!enabled)return {enabled,installed:false,...await detachManagementSkill({codexHome}),reconnectRequired:action!=='ensure'}
  await mkdir(directory,{recursive:true,mode:0o700});const parent=await lstat(directory)
  if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('MANAGEMENT_PLUGIN_PATH_CONFLICT')
  const managed=await owned(path)
  if(managed===false)throw Error('MANAGEMENT_PLUGIN_PATH_CONFLICT')
  const contents=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(join(source,file))]))),hashes=Object.fromEntries(files.map(file=>[file,hash(contents[file])]))
  if(managed){const old=JSON.parse(await readFile(join(path,marker),'utf8'));if(files.every(file=>old.hashes[file]===hashes[file])){await removeOwned(legacyPath);return {enabled,installed:true}}}
  const stage=path+'.'+randomUUID()+'.tmp',backup=path+'.'+randomUUID()+'.previous'
  await mkdir(join(stage,'agents'),{recursive:true,mode:0o700})
  try{
   for(const file of files)await writeFile(join(stage,file),contents[file],{mode:0o600})
   await writeFile(join(stage,marker),JSON.stringify({owner:'zerolink-management',version:1,hashes}),{mode:0o600})
   if(managed)await rename(path,backup)
   try{await rename(stage,path)}catch(error){if(managed)await rename(backup,path);throw error}
   if(managed)await rm(backup,{recursive:true})
  }finally{await rm(stage,{recursive:true,force:true})}
  await removeOwned(legacyPath)
  return {enabled,installed:true,reconnectRequired:action!=='ensure'}
 }finally{await release()}
}
export async function runManagementPlugin(action,accountId='default'){await assertAccount(accountId);return managementPlugin({action,accountId})}
